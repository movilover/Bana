import React, { useEffect, useState } from 'react';
import { X, Upload, Trash2, Loader2, Package } from 'lucide-react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  DEFAULT_PRODUCT_CATEGORIES,
  type BanaMarketListing,
  type BanaStore,
  type ProductCategoryItem,
} from '@/src/types/bana';
import { compressImageFile, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

interface ListingFormModalProps {
  isOpen: boolean;
  editingListing?: BanaMarketListing | null;
  categories: ProductCategoryItem[];
  sellerStore?: BanaStore | null;
  onClose: () => void;
  onSaved: () => void;
}

const DELIVERY_OPTIONS = ['Standard Courier', 'Express Courier', 'Local Pickup'];

export function ListingFormModal({
  isOpen,
  editingListing,
  categories,
  sellerStore,
  onClose,
  onSaved,
}: ListingFormModalProps) {
  const { firebaseUser, profile } = useAuth();
  const toast = useToast();

  const availableCats = categories.length > 0 ? categories : DEFAULT_PRODUCT_CATEGORIES;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<'BDT' | 'USD'>('BDT');
  const [category, setCategory] = useState<string>(availableCats[0]?.name || 'Electronics');
  const [subcategory, setSubcategory] = useState<string>('');
  const [condition, setCondition] = useState<'New' | 'Like New' | 'Used' | 'Refurbished'>('New');
  const [quantity, setQuantity] = useState('1');
  const [deliveryFee, setDeliveryFee] = useState('60');
  const [deliveryOptions, setDeliveryOptions] = useState<string[]>(['Standard Courier', 'Local Pickup']);
  const [location, setLocation] = useState('Dhaka');
  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploadPct, setUploadPct] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setUploadPct(0);
    setNewFiles([]);
    if (editingListing) {
      setTitle(editingListing.title);
      setDescription(editingListing.description);
      setPrice(String(editingListing.price));
      setCurrency(editingListing.currency === 'USD' ? 'USD' : 'BDT');
      setCategory(editingListing.category || availableCats[0]?.name || 'Electronics');
      setSubcategory(editingListing.subcategory || '');
      setCondition(editingListing.condition || 'New');
      setQuantity(String(editingListing.quantity ?? 1));
      setDeliveryFee(String(editingListing.deliveryFee ?? 60));
      setDeliveryOptions(
        editingListing.deliveryOptions?.length ? editingListing.deliveryOptions : ['Standard Courier', 'Local Pickup']
      );
      setLocation(editingListing.location || 'Dhaka');
      setExistingUrls(editingListing.imageUrls || []);
    } else {
      setTitle('');
      setDescription('');
      setPrice('');
      setCurrency('BDT');
      const firstCat = availableCats[0];
      setCategory(firstCat?.name || 'Electronics');
      setSubcategory(firstCat?.subcategories?.[0] || '');
      setCondition('New');
      setQuantity('5');
      setDeliveryFee('60');
      setDeliveryOptions(['Standard Courier', 'Local Pickup']);
      setLocation(sellerStore?.district || profile?.location || 'Dhaka');
      setExistingUrls([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editingListing]);

  useEffect(() => {
    const urls = newFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [newFiles]);

  if (!isOpen) return null;

  const selectedCatObj = availableCats.find((c) => c.name === category);
  const subcatChoices = selectedCatObj?.subcategories || [];

  const toggleDeliveryOption = (opt: string) => {
    setDeliveryOptions((prev) =>
      prev.includes(opt) ? (prev.length > 1 ? prev.filter((x) => x !== opt) : prev) : [...prev, opt]
    );
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const remainingSlots = Math.max(0, 6 - existingUrls.length);
    setNewFiles((prev) => [...prev, ...picked].slice(0, remainingSlots));
    e.target.value = '';
  };

  const saveListing = async (targetStatus: 'active' | 'draft') => {
    if (!firebaseUser || !profile) return;
    if (title.trim().length < 3) {
      setError('Product title must be at least 3 characters.');
      return;
    }
    if (description.trim().length < 10) {
      setError('Product description must be at least 10 characters.');
      return;
    }
    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Enter a valid non-negative price.');
      return;
    }
    const parsedQty = Math.max(0, Math.floor(Number(quantity) || 0));

    setSubmitting(true);
    setError(null);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < newFiles.length; i++) {
        const compressed = await compressImageFile(newFiles[i], 1400);
        const url = await uploadMediaWithProgress(
          `market/${firebaseUser.uid}/item_${Date.now()}_${i}_${compressed.name}`,
          compressed,
          (pct) => setUploadPct(Math.round(((i + pct / 100) / newFiles.length) * 100))
        );
        uploadedUrls.push(url);
      }

      const finalImages = [...existingUrls, ...uploadedUrls].slice(0, 6);
      const suspiciousTerms = ['weapon', 'counterfeit', 'scam', 'prescription', 'crypto giveaway'];
      const textBlob = `${title} ${description}`.toLowerCase();
      const needsModeration = targetStatus === 'active' && suspiciousTerms.some((t) => textBlob.includes(t));

      const finalStatus =
        targetStatus === 'draft'
          ? 'draft'
          : needsModeration
          ? 'pending_review'
          : parsedQty === 0
          ? 'out_of_stock'
          : 'active';

      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        price: parsedPrice,
        currency,
        category,
        subcategory: subcategory || '',
        condition,
        quantity: parsedQty,
        deliveryOptions,
        deliveryFee: Math.max(0, Number(deliveryFee) || 0),
        location: location.trim() || 'Dhaka',
        imageUrls: finalImages,
        storeId: sellerStore?.id || '',
        storeName: sellerStore?.name || '',
        status: finalStatus,
        updatedAt: serverTimestamp(),
      };

      if (editingListing) {
        await updateDoc(doc(db, 'marketplaceListings', editingListing.id), payload);
        toast.success(targetStatus === 'draft' ? 'Saved listing as draft.' : 'Listing updated.');
      } else {
        await addDoc(collection(db, 'marketplaceListings'), {
          ...payload,
          sellerId: firebaseUser.uid,
          sellerName: profile.displayName,
          sellerUsername: profile.username,
          sellerAvatar: profile.avatarUrl || '',
          soldCount: 0,
          ratingAvg: 0,
          reviewsCount: 0,
          viewsCount: 0,
          savesCount: 0,
          createdAt: serverTimestamp(),
        });
        toast.success(
          finalStatus === 'draft'
            ? 'Saved listing as draft.'
            : finalStatus === 'pending_review'
            ? 'Submitted for moderation review.'
            : 'Product published on BANA Marketplace!'
        );
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-[#1877F2]" />
            <h2 className="font-display font-bold text-lg">
              {editingListing ? 'Edit Product Listing' : 'Create Product Listing'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close listing modal"
            className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Product Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Jamdani Handloom Sharee or Sony WH-1000XM5"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Description & Specifications</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe materials, warranty, sizing, condition, and delivery details..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[11px] text-neutral-500 mb-1">Price</label>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as 'BDT' | 'USD')}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 text-xs font-mono"
              >
                <option value="BDT">BDT (৳)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Stock Quantity</label>
              <input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Delivery Fee</label>
              <input
                type="number"
                min={0}
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setCategory(nextName);
                  const found = availableCats.find((c) => c.name === nextName);
                  setSubcategory(found?.subcategories?.[0] || '');
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {availableCats.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Subcategory</label>
              {subcatChoices.length > 0 ? (
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                >
                  <option value="">General</option>
                  {subcatChoices.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  placeholder="Optional subcategory"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
              )}
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as any)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="New">New</option>
                <option value="Like New">Like New</option>
                <option value="Used">Used</option>
                <option value="Refurbished">Refurbished</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">City / District</label>
              <select
                value={BANGLADESH_DISTRICTS.includes(location) ? location : 'Dhaka'}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Delivery Options</label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {DELIVERY_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleDeliveryOption(opt)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border ${
                      deliveryOptions.includes(opt)
                        ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-500'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Multi-image picker + preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">
                Product Photos ({existingUrls.length + newFiles.length}/6)
              </label>
              {existingUrls.length + newFiles.length < 6 && (
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <Upload className="w-3.5 h-3.5" /> Add Photos
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {(existingUrls.length > 0 || previewUrls.length > 0) && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {existingUrls.map((url, idx) => (
                  <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800">
                    <img src={url} alt={`Product ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setExistingUrls((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {previewUrls.map((url, idx) => (
                  <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-blue-300 dark:border-blue-800">
                    <img src={url} alt={`New upload ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setNewFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {submitting && newFiles.length > 0 && (
              <div className="space-y-1">
                <div className="h-1.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-[#1877F2] transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
                <p className="text-[11px] text-neutral-500">Uploading product images... {uploadPct}%</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-neutral-800">
          <button
            type="button"
            disabled={submitting}
            onClick={() => saveListing('draft')}
            className="px-4 h-10 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => saveListing('active')}
            className="px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {editingListing ? 'Update & Publish' : 'Publish Listing'}
          </button>
        </div>
      </div>
    </div>
  );
}
