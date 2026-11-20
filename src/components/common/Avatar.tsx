import React, { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-24 w-24 text-2xl',
};

export function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const [errored, setErrored] = useState(false);
  const initials = (name || 'B')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (!src || errored) {
    return (
      <div
        className={`${SIZE_MAP[size]} rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 font-display font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
        aria-label={name}
      >
        {initials}
      </div>
    );
  }

  return (
    <img loading="lazy"
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={`${SIZE_MAP[size]} rounded-full object-cover bg-neutral-100 dark:bg-neutral-800 shrink-0 ${className}`}
    />
  );
}

export function ResilientImage({
  src,
  alt,
  className = '',
  fallbackLabel,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-900 dark:to-neutral-800 text-neutral-500 dark:text-neutral-400 ${className}`}
      >
        <ImageIcon className="w-6 h-6 mb-1.5 opacity-60" />
        <span className="text-xs font-medium px-3 text-center truncate max-w-full">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setErrored(true)}
      className={className}
    />
  );
}
