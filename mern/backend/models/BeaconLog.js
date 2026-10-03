import mongoose from "mongoose";

const beaconLogSchema = new mongoose.Schema({
    beaconId:  { type: String, required: true },
    x:         { type: Number, required: true },
    y:         { type: Number, required: true },
    rssi:      { type: Number, required: true },
    sessionId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("BeaconLog", beaconLogSchema);