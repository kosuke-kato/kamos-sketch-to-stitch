require('dotenv').config();
const app = require('./functions/server-app');

const PORT = process.env.PORT || 3000;

// Start Express Server locally
app.listen(PORT, () => {
  console.log(`⚡ Kamos Sketch-to-Stitch server running on http://localhost:${PORT}`);
});
