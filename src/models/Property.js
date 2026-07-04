import mongoose from 'mongoose';

/**
 * A saved property/unit belonging to a customer — the backbone of the
 * Property Manager dashboard. A PM overseeing 30 apartments keeps them all
 * under one account; bookings link back via Booking.propertyId so the portal
 * can group status/history per property.
 *
 * Archived (not deleted) so booking history keeps its grouping forever.
 */
const propertySchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },

    // Friendly name shown on the dashboard card, e.g. "123 Main St · Unit 2B".
    label: { type: String, trim: true, maxlength: 120, default: '' },

    street: { type: String, required: true, trim: true, maxlength: 160 },
    apt: { type: String, trim: true, maxlength: 40, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    state: { type: String, trim: true, maxlength: 16, default: '' },
    zip: { type: String, trim: true, maxlength: 16, default: '' },

    // Standing details so per-property bookings prefill correctly.
    bedrooms: { type: String, trim: true, maxlength: 40, default: '' },
    bathrooms: { type: String, trim: true, maxlength: 40, default: '' },
    size: { type: String, trim: true, maxlength: 40, default: '' },
    access: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },

    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, strict: 'throw', minimize: true }
);

propertySchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    label: this.label || [this.street, this.apt].filter(Boolean).join(' · '),
    street: this.street,
    apt: this.apt,
    city: this.city,
    state: this.state,
    zip: this.zip,
    bedrooms: this.bedrooms,
    bathrooms: this.bathrooms,
    size: this.size,
    access: this.access,
    notes: this.notes,
    archived: this.archived,
    createdAt: this.createdAt,
  };
};

export const Property = mongoose.model('Property', propertySchema);
