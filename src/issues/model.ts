export type Attachment = {
  id: string;
  file: string;
  createdAt: string;
  durationMs?: number;
  waveform?: number[];
};
export type CaptureLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};
export type Issue = {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  photos: Attachment[];
  audio: Attachment[];
  status: 'draft' | 'pending_upload' | 'uploaded';
  upload?: {
    metadata: string;
    retryAt?: number;
    lastStatus?: number;
    attempts?: number;
    error?: string;
    serverIssueId?: string;
    uploadedAt?: string;
    attachments?: {
      id: string;
      clientAttachmentId: string;
      contentPath: string;
    }[];
  };
  firstPhotoId?: string;
  location?: CaptureLocation;
  locationSource?: 'manual';
  locationStatus: 'none' | 'pending' | 'captured' | 'unavailable';
};
export const hasContent = (issue: Issue) =>
  Boolean(
    issue.description.trim() || issue.photos.length || issue.audio.length,
  );
export const newId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
export function createIssue(ownerId: string): Issue {
  const now = new Date().toISOString();
  return {
    id: newId(),
    ownerId,
    createdAt: now,
    updatedAt: now,
    description: '',
    photos: [],
    audio: [],
    status: 'draft',
    locationStatus: 'none',
  };
}

export function issueName(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
