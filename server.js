const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
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

// ==================== MAIN API - /tg ====================

app.get('/tg', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { num, key } = req.query;

        // Validate only required parameters
        if (!num || !key) {
            return res.status(400).json({
                success: false,
                msg: 'Missing parameters. Required: num (phone number) and key (API key)',
                developer: '@sahilxalone',
                usage: '/tg?key=YOUR_KEY&num=PHONE_NUMBER'
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
            console.log(`📡 Calling original API for: ${num}`);
            
            const response = await axios.get(ORIGINAL_API, {
                params: {
                    type: 'tg_num',
                    key: key,
                    query: num  // Direct passthrough - no validation
                },
                timeout: 15000,
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

            // Check if API returned error
            if (result.msg === 'Error' || !result.tg_id) {
                throw new Error('API returned error or no data');
            }

            // Update rate limit counter
            data.used += 1;
            saveData(data);

            // Calculate response time
            const responseTime = Date.now() - startTime;

            // ==================== RETURN ORIGINAL RESPONSE ====================
            return res.json({
                msg: result.msg || 'Details fetched',
                tg_id: result.tg_id,
                country: result.country || 'Unknown',
                country_code: result.country_code || '',
                number: result.number || num,
                req_left: DAILY_LIMIT - data.used,
                req_total: DAILY_LIMIT,
                expiry: result.expiry || '30-08-2026',
                developer: '@sahilxalone',  // Changed from original
                success: true,
                cached: result.cached || false,
                response_time: `${responseTime}ms`,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            // ==================== HANDLE API ERRORS ====================
            console.error('❌ API Error:', error.message);

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
                    developer: '@sahilxalone',
                    error: error.message
                });
            }
        }
    } catch (error) {
        // ==================== HANDLE SERVER ERRORS ====================
        console.error('❌ Server error:', error);
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
    console.error('❌ Unhandled error:', err);
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
    console.log(`🔄 Direct passthrough - No validation`);
    console.log('=================================');
});
