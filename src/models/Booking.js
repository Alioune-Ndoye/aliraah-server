import mongoose from 'mongoose';

/**
 * A booking / quote request submitted from the website.
 * Holds the customer's contact + address + schedule + service details so the
 * whole job lives in one record (the CRM/dashboard reads from here).
 *
 * PII (phone, email, address) is stored because the business needs it to deliver
 * the service — protect it operationally (see SECURITY.md): least-privilege DB
 * user, IP allowlisting, TLS, and admin-only access to these records.
 */
const bookingSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['booking', 'quote'], default: 'booking', index: true },

    // Set server-side from the auth cookie when a logged-in customer books.
    // Guest bookings leave this unset. Never trusted from the client payload.
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },

    // Property this booking belongs to (PM dashboard grouping). Only set
    // server-side after verifying the property belongs to the logged-in
    // customer — never trusted from the raw payload.
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', index: true },

    // Crew dispatch — separate from the admin pipeline `status`, so assigning
    // a cleaner never disturbs the owner's new/contacted/scheduled workflow.
    cleanerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cleaner', index: true },
    dispatch: {
      type: String,
      enum: ['none', 'offered', 'accepted', 'declined', 'on_the_way', 'in_progress', 'done'],
      default: 'none',
      index: true,
    },

    // Contact
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80, default: '' },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 40 },
    smsOptIn: { type: Boolean, default: false },

    // Address
    street: { type: String, trim: true, maxlength: 160, default: '' },
    apt: { type: String, trim: true, maxlength: 40, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    state: { type: String, trim: true, maxlength: 16, default: '' },
    zip: { type: String, trim: true, maxlength: 16, default: '' },

    // Service details
    size: { type: String, trim: true, maxlength: 40, default: '' },
    bedrooms: { type: String, trim: true, maxlength: 40, default: '' },
    bathrooms: { type: String, trim: true, maxlength: 40, default: '' },
    frequency: { type: String, trim: true, maxlength: 40, default: '' },
    extras: { type: [String], default: [] },
    access: { type: String, trim: true, maxlength: 80, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },

    // Schedule
    date: { type: String, trim: true, maxlength: 20, default: '' }, // YYYY-MM-DD
    time: { type: String, trim: true, maxlength: 20, default: '' },

    // Pricing snapshot at time of booking
    estimatedTotal: { type: Number, default: 0, min: 0 },
    estimatedHours: { type: Number, default: 0, min: 0 },
    tip: { type: Number, default: 0, min: 0 },
    promoCode: { type: String, trim: true, maxlength: 40, default: '' },

    // Pipeline status for the dashboard
    status: {
      type: String,
      enum: ['new', 'contacted', 'scheduled', 'completed', 'cancelled'],
      default: 'new',
      index: true,
    },

    // Internal metadata (not exposed publicly)
    ipHash: { type: String, default: '' },
    userAgent: { type: String, maxlength: 256, default: '' },
  },
  { timestamps: true, strict: 'throw', minimize: true }
);

bookingSchema.index({ createdAt: -1 });

export const Booking = mongoose.model('Booking', bookingSchema);
