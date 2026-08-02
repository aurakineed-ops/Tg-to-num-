const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const DAILY_LIMIT = 2000;
const ORIGINAL_API = 'https://rootx-osint.in/';

// Rate limit storage (in-memory for Vercel)
const rateLimitMap = new Map();

function getRateLimit(ip) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${ip}_${today}`;
    return rateLimitMap.get(key) || 0;
}

function incrementRateLimit(ip) {
    const today = new Date().toISOString().split('T')[0];
    const key = `${ip}_${today}`;
    const current = rateLimitMap.get(key) || 0;
    rateLimitMap.set(key, current + 1);
    return current + 1;
}

app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ==================== MAIN API ====================
app.get('/tg', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { num, key } = req.query;

        if (!num || !key) {
            return res.status(400).json({
                success: false,
                msg: 'Missing parameters. Required: num and key',
                developer: '@sahilxalone',
                usage: '/tg?key=YOUR_KEY&num=PHONE_NUMBER'
            });
        }

        // Rate limit check
        const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
        const used = getRateLimit(clientIP);

        if (used >= DAILY_LIMIT) {
            return res.status(429).json({
                success: false,
                msg: `Daily limit exceeded. Maximum ${DAILY_LIMIT} requests per day.`,
                req_left: 0,
                req_total: DAILY_LIMIT,
                developer: '@sahilxalone'
            });
        }

        // Call API
        const response = await axios.get(ORIGINAL_API, {
            params: {
                type: 'tg_num',
                key: key,
                query: num
            },
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        if (response.status !== 200 || response.data.msg === 'Error' || !response.data.tg_id) {
            throw new Error('API returned error or no data');
        }

        // Increment rate limit
        const newCount = incrementRateLimit(clientIP);

        const responseTime = Date.now() - startTime;

        return res.json({
            msg: response.data.msg || 'Details fetched',
            tg_id: response.data.tg_id,
            country: response.data.country || 'Unknown',
            country_code: response.data.country_code || '',
            number: response.data.number || num,
            req_left: DAILY_LIMIT - newCount,
            req_total: DAILY_LIMIT,
            expiry: response.data.expiry || '30-08-2026',
            developer: '@sahilxalone',
            success: true,
            cached: response.data.cached || false,
            response_time: `${responseTime}ms`,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error:', error.message);
        return res.status(500).json({
            success: false,
            msg: 'Error fetching data',
            developer: '@sahilxalone',
            error: error.message
        });
    }
});

// ==================== STATUS ====================
app.get('/status', (req, res) => {
    res.json({
        success: true,
        daily_limit: DAILY_LIMIT,
        developer: '@sahilxalone',
        status: 'active'
    });
});

// ==================== HEALTH ====================
app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        developer: '@sahilxalone'
    });
});

// ==================== ROOT ====================
app.get('/', (req, res) => {
    res.json({
        name: 'Telegram OSINT API',
        version: '1.0.0',
        endpoints: {
            '/tg': '/tg?key=YOUR_KEY&num=PHONE_NUMBER',
            '/status': 'Check status',
            '/health': 'Health check'
        },
        rate_limit: `${DAILY_LIMIT} requests per day`,
        developer: '@sahilxalone'
    });
});

// ==================== 404 ====================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        msg: 'Endpoint not found',
        developer: '@sahilxalone'
    });
});

module.exports = app;
