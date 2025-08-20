const express = require('express');
const app = express();
const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/roblox-backend', { useNewUrlParser: true, useUnifiedTopology: true });

const User = mongoose.model('User', {
  username: String,
  placeId: String,
  instanceId: String
});

app.use(bodyParser.json());

app.post('/user', async (req, res) => {
  const { username } = req.body;
  const user = await User.findOne({ username });
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/teleport', async (req, res) => {
  const { username, placeId, instanceId } = req.body;
  const user = await User.findOne({ username });
  if (user) {
    TeleportService:TeleportToPlaceInstance(placeId, instanceId, user);
    res.json({ message: 'User teleported' });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});
