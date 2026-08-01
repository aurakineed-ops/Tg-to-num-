const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DAILY_LIMIT = 2000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ORIGINAL_API = 'https://rootx-osint.in/';

// Middleware
app.use(express.json());

// ==================== HELPER FUNCTIONS ====================

// Load rate limit data
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
    return { used: 0, date: new Date().toISOString().split('T')[0] };
}

// Save rate limit data
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Clean phone number (remove non-digits)
function cleanPhoneNumber(query) {
    return query.replace(/\D/g, '');
}

// Get client IP
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.ip || 
           req.connection.remoteAddress || 
           'unknown';
}

// ==================== CORS MIDDLEWARE ====================

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ==================== MAIN API ENDPOINT - /tg ====================

app.get('/tg', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { num, key } = req.query;

        // Validate parameters
        if (!num || !key) {
            return res.status(400).json({
                success: false,
                msg: 'Missing parameters. Required: num (phone number) and key (API key)',
                developer: '@sahilxalone',
                usage: '/tg?key=YOUR_KEY&num=PHONE_NUMBER'
            });
        }

        // Clean and validate phone number
        const cleanQuery = cleanPhoneNumber(num);
        if (cleanQuery.length < 10) {
            return res.status(400).json({
                success: false,
                msg: 'Invalid phone number. Minimum 10 digits required.',
                developer: '@sahilxalone'
            });
        }

        // ==================== RATE LIMIT CHECK ====================
        const today = new Date().toISOString().split('T')[0];
        let data = loadData();

        // Reset counter if new day
        if (data.date !== today) {
            data = { used: 0, date: today };
        }

        // Check if daily limit exceeded
        if (data.used >= DAILY_LIMIT) {
            return res.status(429).json({
                success: false,
                msg: `Daily limit exceeded. Maximum ${DAILY_LIMIT} requests per day.`,
                req_left: 0,
                req_total: DAILY_LIMIT,
                developer: '@sahilxalone',
                reset_time: 'Midnight UTC',
                current_used: data.used
            });
        }

        // ==================== CALL ORIGINAL API ====================
        try {
            const response = await axios.get(ORIGINAL_API, {
                params: {
                    type: 'tg_num',
                    key: key,
                    query: cleanQuery
                },
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                }
            });

            // Check if API responded with valid data
            if (response.status !== 200) {
                throw new Error(`API returned status ${response.status}`);
            }

            const result = response.data;

            // Validate response data
            if (!result.tg_id || result.msg === 'Error') {
                throw new Error('Invalid data received from API');
            }

            // Update rate limit counter
            data.used += 1;
            saveData(data);

            // Calculate response time
            const responseTime = Date.now() - startTime;

            // ==================== PREPARE FINAL RESPONSE ====================
            const finalResponse = {
                msg: 'Details fetched',
                tg_id: result.tg_id,
                country: result.country || 'Unknown',
                country_code: result.country_code || '',
                number: result.number || cleanQuery.slice(-8),
                req_left: DAILY_LIMIT - data.used,
                req_total: DAILY_LIMIT,
                expiry: result.expiry || '30-08-2026',
                developer: '@sahilxalone',
                success: true,
                cached: result.cached || false,
                response_time: `${responseTime}ms`,
                timestamp: new Date().toISOString()
            };

            return res.json(finalResponse);

        } catch (error) {
            // ==================== HANDLE API ERRORS ====================
            console.error('API Error:', error.message);

            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                return res.status(504).json({
                    success: false,
                    msg: 'API timeout. Please try again later.',
                    developer: '@sahilxalone',
                    error: 'Timeout'
                });
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                return res.status(503).json({
                    success: false,
                    msg: 'Unable to connect to API. Service might be down.',
                    developer: '@sahilxalone',
                    error: 'Connection failed'
                });
            } else if (error.response) {
                return res.status(error.response.status || 500).json({
                    success: false,
                    msg: 'API returned an error',
                    developer: '@sahilxalone',
                    status: error.response.status,
                    details: error.response.data
                });
            } else {
                return res.status(404).json({
                    success: false,
                    msg: 'Number not found or API unavailable',
                    developer: '@sahilxalone'
                });
            }
        }
    } catch (error) {
        // ==================== HANDLE SERVER ERRORS ====================
        console.error('Server error:', error);
        return res.status(500).json({
            success: false,
            msg: 'Internal server error. Please try again later.',
            developer: '@sahilxalone',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ==================== STATUS ENDPOINT ====================

app.get('/status', (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const data = loadData();
        
        const used = data.date === today ? data.used : 0;
        const left = DAILY_LIMIT - used;
        
        res.json({
            success: true,
            daily_limit: DAILY_LIMIT,
            requests_used: used,
            requests_left: left,
            percentage_used: Math.round((used / DAILY_LIMIT) * 100),
            reset_time: 'Midnight UTC',
            current_date: today,
            developer: '@sahilxalone'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            msg: 'Error fetching status',
            developer: '@sahilxalone'
        });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        developer: '@sahilxalone',
        version: '1.0.0'
    });
});

// ==================== ROOT INFO ====================

app.get('/', (req, res) => {
    res.json({
        name: 'Telegram OSINT API',
        version: '1.0.0',
        description: 'Fetch Telegram user details from phone number',
        endpoints: {
            '/tg': 'Main API - /tg?key=YOUR_KEY&num=PHONE_NUMBER',
            '/status': 'Check rate limit status',
            '/health': 'Health check',
            '/': 'This information'
        },
        rate_limit: `${DAILY_LIMIT} requests per day`,
        developer: '@sahilxalone'
    });
});

// ==================== 404 HANDLER ====================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        msg: 'Endpoint not found. Use /tg?key=YOUR_KEY&num=PHONE_NUMBER',
        developer: '@sahilxalone',
        available_endpoints: ['/tg', '/status', '/health', '/']
    });
});

// ==================== ERROR HANDLER ====================

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        msg: 'Internal server error',
        developer: '@sahilxalone',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ==================== START SERVER ====================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`👨‍💻 Developer: @sahilxalone`);
    console.log(`📊 Daily limit: ${DAILY_LIMIT} requests`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📡 Endpoint: /tg?key=YOUR_KEY&num=PHONE_NUMBER`);
    console.log('=================================');
});
