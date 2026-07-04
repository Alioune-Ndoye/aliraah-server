import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * A cleaner / crew member. Managed by the admin; the cleaner accesses their
 * job page through an unguessable token link (no password) — the owner sends
 * them that link once, they bookmark it. Their phone number is how we reach
 * them (job-offer texts via the same SMS pipe as owner alerts).
 */
const cleanerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80, default: '' },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, default: '' },

    // Permanent portal key: /crew/<token>. 32 hex chars, crypto RNG.
    token: { type: String, required: true, unique: true, index: true },

    status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: '' }, // admin notes
  },
  { timestamps: true, strict: 'throw', minimize: true }
);

cleanerSchema.statics.newToken = () => crypto.randomBytes(16).toString('hex');

/** Shape for the admin dashboard (includes the portal token so the owner can share the link). */
cleanerSchema.methods.toAdmin = function toAdmin() {
  return {
    id: this._id.toString(),
    firstName: this.firstName,
    lastName: this.lastName,
    phone: this.phone,
    email: this.email,
    token: this.token,
    status: this.status,
    notes: this.notes,
    createdAt: this.createdAt,
  };
};

/** Shape for the cleaner's own crew page — no admin notes. */
cleanerSchema.methods.toCrew = function toCrew() {
  return {
    id: this._id.toString(),
    firstName: this.firstName,
    lastName: this.lastName,
    phone: this.phone,
    status: this.status,
  };
};

export const Cleaner = mongoose.model('Cleaner', cleanerSchema);
