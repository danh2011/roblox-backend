// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(bodyParser.json());
app.use(cors()); // optional but harmless

// === CONFIG ===
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/roblox-backend';
const PORT = process.env.PORT || 3000;
// ==============

// Mongo setup
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exitCode = 1;
  });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  userId: Number,
  placeId: String,
  instanceId: String,
  lastSeenAt: Date
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Helper: get userId from username
async function getUserIdByUsername(username) {
  try {
    const resp = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username] }, {
      headers: { 'Content-Type': 'application/json' }
    });
    const entry = (resp.data && resp.data.data && resp.data.data[0]) || null;
    if (entry && entry.id) return entry.id;
    return null;
  } catch (err) {
    console.error('getUserIdByUsername error', err?.response?.data || err.message);
    throw err;
  }
}

// Helper: check presence
async function getPresenceForUserId(userId) {
  try {
    const resp = await axios.post('https://presence.roblox.com/v1/presence/users', { userIds: [userId] }, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (!resp.data || !Array.isArray(resp.data) || resp.data.length === 0) return null;
    return resp.data[0];
  } catch (err) {
    console.error('getPresenceForUserId error', err?.response?.data || err.message);
    throw err;
  }
}

// POST /user
// body: { username: string, mode: "Standard" | "UltraFast" }
app.post('/user', async (req, res) => {
  try {
    const { username, mode } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });

    // Resolve userId
    let userId = null;
    // Check DB first
    let stored = await User.findOne({ username: username }).exec();
    if (stored && stored.userId) {
      userId = stored.userId;
    } else {
      userId = await getUserIdByUsername(username);
      if (!userId) {
        return res.json({ online: false, message: 'User not found' });
      }
    }

    // Query presence
    let presence = null;
    try {
      presence = await getPresenceForUserId(userId);
    } catch (err) {
      // If presence call fails, fallback to stored DB entry if available
      console.warn('Presence check failed, falling back to DB if possible.');
      presence = null;
    }

    let online = false;
    let placeId = null;
    let instanceId = null;

    if (presence && typeof presence.userPresenceType !== 'undefined') {
      // userPresenceType: 1 usually indicates online (per community docs)
      if (presence.userPresenceType === 1) {
        online = true;
        // Some presence responses include placeId and gameInstanceId
        placeId = presence.placeId || presence.rootPlaceId || null;
        instanceId = presence.gameInstanceId || presence.gameId || presence.gameInstanceId || null;
      }
    }

    // If online but missing fields, try DB fallback
    if (online && (!placeId || !instanceId)) {
      if (stored && stored.placeId && stored.instanceId) {
        placeId = placeId || stored.placeId;
        instanceId = instanceId || stored.instanceId;
      }
    }

    // If not online but stored info exists, return offline info
    if (!online) {
      // Update stored userId if we resolved it newly
      if (!stored) {
        stored = await User.create({ username, userId });
      } else if (!stored.userId) {
        stored.userId = userId;
        await stored.save();
      }

      return res.json({ online: false, message: `${username} is offline or presence unavailable.` });
    }

    // At this point online === true and we should have placeId & instanceId
    // Save/update DB with latest location
    if (!stored) {
      stored = new User({ username, userId, placeId: String(placeId), instanceId: String(instanceId), lastSeenAt: new Date() });
      await stored.save();
    } else {
      stored.userId = userId;
      stored.placeId = String(placeId);
      stored.instanceId = String(instanceId);
      stored.lastSeenAt = new Date();
      await stored.save();
    }

    return res.json({
      online: true,
      username,
      userId,
      placeId: String(placeId),
      instanceId: String(instanceId),
      mode: mode || "Standard"
    });
  } catch (err) {
    console.error('Error in /user:', err?.response?.data || err.message);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
