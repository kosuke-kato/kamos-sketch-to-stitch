const { onRequest } = require("firebase-functions/v2/https");
const app = require("../server-app");

// Export the Express app as a v2 HTTP Cloud Function named 'api'
exports.api = onRequest({
  cors: true,
  timeoutSeconds: 300,
  memory: "1GiB"
}, app);
