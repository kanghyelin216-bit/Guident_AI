import mongoose from "mongoose";

const congestionLogSchema = new mongoose.Schema({
    scannerId:  { type: String, required: true },
    zone:       { type: String, default: null },
    count:      { type: Number, required: true },
    status:     { type: String, enum: ["여유", "보통", "혼잡"], required: true },
    recordedAt: { type: Date, default: Date.now },
});

export default mongoose.model("CongestionLog", congestionLogSchema);