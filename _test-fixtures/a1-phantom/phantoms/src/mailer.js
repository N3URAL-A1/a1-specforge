function sendEmail(to, body) { return { to, body, sent: true }; }
module.exports = { sendEmail };
