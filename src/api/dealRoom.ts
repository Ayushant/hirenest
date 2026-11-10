import type {
  DealRoom,
  DealRoomMessage,
  DealRoomParticipant,
  ContactDetailRequest,
  DealRoomAuditEvent,
  ContactRequestStatus,
} from '../lib/dealRoom';
import { supabase } from '../lib/supabase';

const BASE = '/api/deal-rooms';

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession().catch(() => ({
    data: { session: null },
  }));
  const token = sessionData?.session?.access_token;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export async function fetchDealRooms(): Promise<DealRoom[]> {
  const data = await apiFetch<{ ok: boolean; rooms: DealRoom[] }>(BASE);
  return data.rooms;
}

export async function fetchDealRoom(roomId: string): Promise<{
  room: DealRoom;
  participants: DealRoomParticipant[];
  messages: DealRoomMessage[];
  contactRequests: ContactDetailRequest[];
  auditEvents: DealRoomAuditEvent[];
}> {
  return apiFetch(`${BASE}/${roomId}`);
}

export async function createDealRoom(input: {
  submissionId: string;
  reason?: string;
}): Promise<DealRoom> {
  const data = await apiFetch<{ ok: boolean; room: DealRoom }>(`${BASE}/create`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.room;
}

export async function closeDealRoom(roomId: string, reason: string): Promise<void> {
  await apiFetch(`${BASE}/${roomId}/close`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function reopenDealRoom(roomId: string): Promise<void> {
  await apiFetch(`${BASE}/${roomId}/reopen`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function sendMessage(
  roomId: string,
  content: string,
  attachmentUrl?: string | null,
  attachmentName?: string | null
): Promise<DealRoomMessage> {
  const data = await apiFetch<{ ok: boolean; message: DealRoomMessage }>(
    `${BASE}/${roomId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content, attachmentUrl, attachmentName }),
    }
  );
  return data.message;
}

// ---------------------------------------------------------------------------
// Contact detail requests
// ---------------------------------------------------------------------------

export async function submitContactRequest(
  roomId: string,
  contactType: ContactDetailRequest['contactType'],
  reason: string
): Promise<ContactDetailRequest> {
  const data = await apiFetch<{ ok: boolean; request: ContactDetailRequest }>(
    `${BASE}/${roomId}/contact-requests`,
    {
      method: 'POST',
      body: JSON.stringify({ contactType, reason }),
    }
  );
  return data.request;
}

export async function respondToContactRequest(
  roomId: string,
  requestId: string,
  status: ContactRequestStatus,
  disclosureChannel?: string
): Promise<void> {
  await apiFetch(`${BASE}/${roomId}/contact-requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ status, disclosureChannel }),
  });
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export async function addParticipant(
  roomId: string,
  userId: string,
  participantType: string
): Promise<DealRoomParticipant> {
  const data = await apiFetch<{ ok: boolean; participant: DealRoomParticipant }>(
    `${BASE}/${roomId}/participants`,
    {
      method: 'POST',
      body: JSON.stringify({ userId, participantType }),
    }
  );
  return data.participant;
}

export async function removeParticipant(
  roomId: string,
  participantId: string
): Promise<void> {
  await apiFetch(`${BASE}/${roomId}/participants/${participantId}/remove`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Polling helper (for near-real-time)
// ---------------------------------------------------------------------------

export async function pollMessages(
  roomId: string,
  sinceTimestamp: string
): Promise<DealRoomMessage[]> {
  const data = await apiFetch<{ ok: boolean; messages: DealRoomMessage[] }>(
    `${BASE}/${roomId}/messages?since=${encodeURIComponent(sinceTimestamp)}`
  );
  return data.messages;
}
