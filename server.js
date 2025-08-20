// server.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = (process.env.CACHE_TTL_SECONDS ? Number(process.env.CACHE_TTL_SECONDS) * 1000 : 20 * 1000); // default 20s

// In-memory cache: username -> { data, expiresAt }
const cache = new Map();

function setCache(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}
// Periodic cleanup (small)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache.entries()) if (v.expiresAt <= now) cache.delete(k);
}, 30_000);

// Helper: get userId from username
async function getUserIdByUsername(username) {
  const url = 'https://users.roblox.com/v1/usernames/users';
  const resp = await axios.post(url, { usernames: [username] }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000
  });
  const entry = resp.data && resp.data.data && resp.data.data[0];
  return entry ? entry.id : null;
}

// Helper: get presence
async function getPresenceForUserId(userId) {
  const url = 'https://presence.roblox.com/v1/presence/users';
  const resp = await axios.post(url, { userIds: [userId] }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000
  });
  if (!Array.isArray(resp.data) || resp.data.length === 0) return null;
  return resp.data[0];
}

// POST /user { username, mode }
app.post('/user', async (req, res) => {
  try {
    const { username, mode } = (req.body || {});
    if (!username || typeof username !== 'string') return res.status(400).json({ error: 'username required' });

    const uname = username.trim();
    // Return from cache if fresh
    const cached = getCache(uname);
    if (cached) return res.json(cached);

    // Get userId
    let userId = null;
    try {
      userId = await getUserIdByUsername(uname);
    } catch (err) {
      console.error('Error getting userId:', err?.message || err);
      return res.status(502).json({ error: 'Failed to contact Roblox Users API' });
    }
    if (!userId) {
      const resp = { online: false, message: 'User not found' };
      setCache(uname, resp);
      return res.json(resp);
    }

    // Get presence
    let presence = null;
    try {
      presence = await getPresenceForUserId(userId);
    } catch (err) {
      console.error('Error getting presence:', err?.message || err);
      // If presence call fails, return an error
      return res.status(502).json({ error: 'Failed to contact Roblox Presence API' });
    }

    // Inspect presence
    let online = false;
    let placeId = null;
    let instanceId = null;

    if (presence && typeof presence.userPresenceType !== 'undefined') {
      // userPresenceType: 1 => online (community convention)
      if (presence.userPresenceType === 1) {
        online = true;
        // presence may provide placeId/rootPlaceId and gameInstanceId
        placeId = presence.placeId || presence.rootPlaceId || null;
        instanceId = presence.gameInstanceId || presence.gameId || null;
      }
    }

    // Build response
    const response = {
      online,
      message: online ? 'User is online' : `${uname} is offline or presence unavailable.`,
      username: uname,
      userId: userId,
      placeId: placeId ? String(placeId) : null,
      instanceId: instanceId ? String(instanceId) : null,
      mode: mode || 'Standard'
    };

    // Cache and return
    setCache(uname, response);
    return res.json(response);
  } catch (err) {
    console.error('Unhandled error in /user:', err?.message || err);
    return res.status(500).json({ error: 'Server error', details: err?.message || String(err) });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (stateless, no DB). Cache TTL=${CACHE_TTL_MS}ms`);
});
