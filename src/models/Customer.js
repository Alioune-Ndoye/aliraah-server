import mongoose from 'mongoose';

/**
 * A registered customer account. Login is by email + password; `accountNumber`
 * is a membership/reference ID (shown in the portal, printable on a card) — it
 * is NOT a credential on its own.
 *
 * `passwordHash` is a bcrypt hash and is NEVER returned by the API (see toPublic).
 * Admin-only fields (tier, discountRate, recurring, status, notes) can only be
 * changed through the admin routes, never by the customer editing their own profile.
 */
const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true },
    accountNumber: { type: String, required: true, unique: true, index: true },

    phone: { type: String, trim: true, maxlength: 40, default: '' },
    street: { type: String, trim: true, maxlength: 160, default: '' },
    apt: { type: String, trim: true, maxlength: 40, default: '' },
    city: { type: String, trim: true, maxlength: 80, default: '' },
    state: { type: String, trim: true, maxlength: 16, default: '' },
    zip: { type: String, trim: true, maxlength: 16, default: '' },

    // Admin-controlled loyalty fields
    tier: { type: String, enum: ['standard', 'silver', 'gold'], default: 'standard', index: true },
    discountRate: { type: Number, min: 0, max: 100, default: 0 },
    recurring: { type: Boolean, default: false },

    avatarUrl: { type: String, trim: true, maxlength: 2048, default: '' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: '' }, // admin notes

    // Owner-approval gate: accounts start unverified. On signup, an access
    // code is texted to the BUSINESS OWNER, who forwards it to the customer.
    // The account only activates once the customer enters that code.
    verified: { type: Boolean, default: false, index: true },
    verifyCodeHash: { type: String, default: '' },
    verifyCodeExpires: { type: Date },

    lastLoginAt: { type: Date },
  },
  { timestamps: true, strict: 'throw', minimize: true }
);

/** Public shape — safe to return to the browser. Never includes passwordHash. */
customerSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    accountNumber: this.accountNumber,
    phone: this.phone,
    street: this.street,
    apt: this.apt,
    city: this.city,
    state: this.state,
    zip: this.zip,
    tier: this.tier,
    discountRate: this.discountRate,
    recurring: this.recurring,
    avatarUrl: this.avatarUrl,
    status: this.status,
    verified: this.verified,
    createdAt: this.createdAt,
  };
};

export const Customer = mongoose.model('Customer', customerSchema);
