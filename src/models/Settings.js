import mongoose from 'mongoose';

/**
 * Site-wide feature toggles, controlled from the admin dashboard.
 * Stored as a single document (singleton). Public GET exposes only the flags;
 * changing them requires the admin token.
 *
 * Defaults are OFF: Guarantee and Specials stay hidden on the site until the
 * admin explicitly enables them.
 */
const settingsSchema = new mongoose.Schema(
  {
    // Singleton key — always "site". Unique index prevents duplicates.
    key: { type: String, default: 'site', unique: true },

    showGuarantee: { type: Boolean, default: false },
    showSpecials: { type: Boolean, default: false },
  },
  { timestamps: true, strict: 'throw', minimize: true }
);

settingsSchema.statics.get = async function get() {
  return (await this.findOne({ key: 'site' })) ?? (await this.create({ key: 'site' }));
};

settingsSchema.methods.toPublic = function toPublic() {
  return {
    showGuarantee: this.showGuarantee,
    showSpecials: this.showSpecials,
  };
};

export const Settings = mongoose.model('Settings', settingsSchema);
