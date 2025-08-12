const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
    serviceDateTime: { type: Date, required: true },
    topic: { type: String, required: true },
    speaker: { type: String }
});

module.exports = mongoose.model('Service', serviceSchema);
