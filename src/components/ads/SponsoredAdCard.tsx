import React, { useEffect, useState } from 'react';
import { ExternalLink, Info, ShieldCheck, X } from 'lucide-react';
import type { AdCampaign, AdPlacement } from '@/src/types/bana';
import { ResilientImage } from '@/src/components/common/Avatar';
import { dismissAdForSession, trackAdDelivery } from '@/src/lib/ads';
import { useAuth } from '@/src/contexts/AuthContext';

interface SponsoredAdCardProps {
  campaign: AdCampaign;
  placement: AdPlacement;
  variant?: 'feed' | 'reels' | 'marketplace';
  onDismiss?: (campaignId: string) => void;
}

export function SponsoredAdCard({
  campaign,
  placement,
  variant = 'feed',
  onDismiss,
}: SponsoredAdCardProps) {
  const { firebaseUser } = useAuth();
  const [whyOpen, setWhyOpen] = useState(false);

  useEffect(() => {
    trackAdDelivery(campaign, placement, 'impression', firebaseUser?.uid);
  }, [campaign, placement, firebaseUser?.uid]);

  const handleClickCta = () => {
    trackAdDelivery(campaign, placement, 'click', firebaseUser?.uid);
  };

  const handleDismiss = () => {
    dismissAdForSession(campaign.id);
    onDismiss?.(campaign.id);
  };

  let destinationDomain = 'bana.social';
  try {
    destinationDomain = new URL(campaign.destinationUrl).hostname.replace(/^www\./, '');
  } catch {
    destinationDomain = campaign.destinationUrl || 'External Link';
  }

  if (variant === 'reels') {
    return (
      <div className="rounded-[12px] border border-white/20 bg-black/75 backdrop-blur-md text-white p-3.5 space-y-2 shadow-lg max-w-sm">
        <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-300">
          <span className="font-mono font-semibold text-amber-300">
            Sponsored · {campaign.advertiserName || campaign.campaignName}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setWhyOpen((v) => !v)}
              title="Why this ad?"
              className="p-1 rounded hover:bg-white/10"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              title="Hide ad"
              className="p-1 rounded hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {whyOpen && (
          <p className="text-[11px] text-neutral-300 border-t border-white/10 pt-1.5">
            Shown based on non-sensitive regional or topic relevance. Minor accounts are excluded from ad targeting.
          </p>
        )}
        <div className="flex items-center gap-3">
          {campaign.creativeUrl && campaign.creativeType !== 'video' && (
            <ResilientImage
              src={campaign.creativeUrl}
              alt={campaign.headline}
              className="w-12 h-12 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold truncate">{campaign.headline}</p>
            <p className="text-[11px] text-neutral-300 line-clamp-2">{campaign.bodyText}</p>
          </div>
        </div>
        <a
          href={campaign.destinationUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClickCta}
          className="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
        >
          {campaign.ctaLabel || 'Learn More'} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <article className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-neutral-900 dark:text-white truncate">
              {campaign.advertiserName || campaign.campaignName}
            </span>
            <span className="text-neutral-300 dark:text-neutral-700">·</span>
            <span className="font-mono font-semibold text-[#1877F2]">Sponsored</span>
            {campaign.categoryTag && (
              <>
                <span className="text-neutral-300 dark:text-neutral-700">·</span>
                <span className="text-neutral-500">{campaign.categoryTag}</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-neutral-500 font-mono truncate">{destinationDomain}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            title="Why am I seeing this ad?"
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Info className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            title="Hide sponsored post"
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {whyOpen && (
        <div className="px-4 py-2.5 bg-neutral-50 dark:bg-neutral-950 border-b border-neutral-100 dark:border-neutral-800 text-[11px] text-neutral-600 dark:text-neutral-400 flex items-start gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            This advertisement passed BANA review. Delivered using only non-PII regional/interest preferences (no personal private messages or minor profiles).
          </span>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-display font-bold text-base text-neutral-950 dark:text-white">
            {campaign.headline}
          </h3>
          <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1 leading-relaxed">
            {campaign.bodyText}
          </p>
        </div>

        {campaign.creativeUrl && (
          <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950">
            {campaign.creativeType === 'video' ? (
              <video
                src={campaign.creativeUrl}
                controls
                muted
                playsInline
                className={`w-full ${variant === 'marketplace' ? 'max-h-56' : 'max-h-96'} object-cover`}
              />
            ) : (
              <ResilientImage
                src={campaign.creativeUrl}
                alt={campaign.headline}
                className={`w-full ${variant === 'marketplace' ? 'h-48' : 'max-h-96'} object-cover`}
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-neutral-500 font-mono">
            Advertisement · {placement.replace('_', ' ')}
          </span>
          <a
            href={campaign.destinationUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClickCta}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors shrink-0"
          >
            {campaign.ctaLabel || 'Learn More'} <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}
