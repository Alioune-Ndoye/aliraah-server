import mongoose from 'mongoose';

/**
 * Customer review. Schema is strict — unknown fields are dropped, every field
 * is length-bounded, and nothing is stored that we don't explicitly allow.
 * PII is limited to a display name + optional town (never email/phone/address).
 */
const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    role: { type: String, trim: true, maxlength: 80, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    text: { type: String, trim: true, maxlength: 2000, default: '' },

    // External video URL only (e.g. an uploaded clip or a Facebook video link).
    // Raw video files belong in object storage / GridFS, not in this document.
    video: { type: String, trim: true, maxlength: 2048, default: '' },

    // Moderation: nothing is shown publicly until approved.
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    // Operational metadata — not exposed to the public API.
    jobRef: { type: String, trim: true, maxlength: 64, default: '' },
    ipHash: { type: String, default: '' },
    userAgent: { type: String, maxlength: 256, default: '' },
  },
  {
    timestamps: true,
    strict: 'throw', // reject any field not declared above
    minimize: true,
  }
);

/** Shape returned to the public website — strips internal/PII-adjacent fields. */
reviewSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    role: this.role,
    rating: this.rating,
    text: this.text,
    video: this.video || undefined,
    createdAt: this.createdAt,
  };
};

export const Review = mongoose.model('Review', reviewSchema);
