// models/Beacon.js
import mongoose from "mongoose";
export { ChatHistory } from "./ChatHistory.js";

const BeaconSchema = new mongoose.Schema({
  beaconId:  { type: String, required: true, unique: true },
  x:         { type: Number, required: true },   // m
  y:         { type: Number, required: true },   // m
  txPower:   { type: Number, default: -59 },     // dBm (1m 기준)
  mapId:     { type: mongoose.Schema.Types.ObjectId, ref: "Map" },
  label:     { type: String, default: "" },      // 표시 이름
  visible:   { type: Boolean, default: true },   // 지도에 표시 on/off
});

export const Beacon = mongoose.model("Beacon", BeaconSchema);


// models/Map.js
const MapSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  imageUrl:   { type: String, required: true },  // /uploads/... 경로
  widthM:     { type: Number, required: true },  // 실제 가로 길이(m)
  heightM:    { type: Number, required: true },  // 실제 세로 길이(m)
  cellSizeM:  { type: Number, default: 1.0 },    // 그리드 셀 크기(m)
  // 시설 포인트 (화장실, 출구 등)
  facilities: [{
    id:    String,
    label: String,
    x:     Number,
    y:     Number,
    icon:  String,
  }],
  // 벽/장애물 그리드 (1=벽)
  wallGrid: [[Number]],
}, { timestamps: true });

export const Map = mongoose.model("Map", MapSchema);


// models/ScannerReading.js  — 혼잡도 집계용
const ScannerReadingSchema = new mongoose.Schema({
  scannerId:  { type: String, required: true },
  mapId:      { type: mongoose.Schema.Types.ObjectId, ref: "Map" },
  zone:       { type: String, required: true },  // "R01C02"
  x:          Number,
  y:          Number,
  ts:         { type: Date, default: Date.now },
}, { expireAfterSeconds: 300 });  // 5분 후 자동 삭제 (TTL 인덱스)

ScannerReadingSchema.index({ ts: 1 });
export const ScannerReading = mongoose.model("ScannerReading", ScannerReadingSchema);
