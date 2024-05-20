import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const TimelockInfoSchema = new Schema({
  tx: { type: String, index: true },
  ipfs_cidv0: { type: String, index: true },
  ipfs_cidv1: { type: String, index: true },
});

export const TimelockInfo = mongoose.model('TimelockInfo', TimelockInfoSchema);
