import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Lock,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Shield,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
  XCircle,
  CheckCircle2,
  History,
  Eye,
  MailQuestion,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import {
  PageHeader,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  TableSkeleton,
  Tabs,
  Textarea,
} from '../../components/ui/kit';
import { Avatar } from '../../components/ui/kit';
import { useToast as useToastCtx } from '../../components/ui/Toast';

function useToastHelper() {
  const { toast } = useToastCtx();
  return {
    success: (title: string) => toast({ title, tone: 'success' }),
    error: (title: string) => toast({ title, tone: 'error' }),
  };
}
import {
  fetchDealRooms,
  fetchDealRoom,
  createDealRoom,
  closeDealRoom,
  reopenDealRoom,
  sendMessage,
  pollMessages,
  submitContactRequest,
  respondToContactRequest,
  addParticipant,
  removeParticipant,
} from '../../api/dealRoom';
import type {
  DealRoom,
  DealRoomMessage,
  DealRoomParticipant,
  ContactDetailRequest,
  DealRoomAuditEvent,
  ParticipantType,
  ContactRequestStatus,
} from '../../lib/dealRoom';
import {
  DEAL_ROOM_STATUS_LABELS,
  CONTACT_REQUEST_STATUS_LABELS,
  PARTICIPANT_TYPE_LABELS,
  AUDIT_EVENT_LABELS,
} from '../../lib/dealRoom';

// ---------------------------------------------------------------------------
// Deal Rooms List Page
// ---------------------------------------------------------------------------

export const DealRoomsListPage: React.FC = () => {
  const { profile } = useAuth();
  const toast = useToastHelper();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  const { data: rooms, isLoading, error, refetch } = useQuery({
    queryKey: ['deal-rooms'],
    queryFn: fetchDealRooms,
  });

  const isHq = profile?.role === 'admin' || profile?.role === 'recruiter';

  if (selectedRoomId) {
    return (
      <DealRoomDetailView
        roomId={selectedRoomId}
        onBack={() => { setSelectedRoomId(null); refetch(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal Rooms"
        description="Secure, identity-masked communication channels for candidate negotiations"
        actions={
          isHq ? (
            <Button size="sm" variant="secondary" disabled>
              <Shield className="h-3.5 w-3.5" />
              Rooms auto-open on interview selection
            </Button>
          ) : undefined
        }
      />

      {isLoading && <TableSkeleton rows={4} cols={5} />}
      {error && (
        <EmptyState
          title="Failed to load Deal Rooms"
          description={(error as Error).message}
          actionLabel="Retry"
          onAction={() => refetch()}
        />
      )}

      {rooms && rooms.length === 0 && (
        <EmptyState
          title="No Deal Rooms yet"
          description="Deal Rooms are automatically created when a candidate passes an interview and is selected for the next round."
        />
      )}

      {rooms && rooms.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <DealRoomCard
              key={room.id}
              room={room}
              onClick={() => setSelectedRoomId(room.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Deal Room Card
// ---------------------------------------------------------------------------

const DealRoomCard: React.FC<{
  room: DealRoom;
  onClick: () => void;
}> = ({ room, onClick }) => {
  const statusTone = room.status === 'active' ? 'emerald' : 'slate';

  return (
    <div
      onClick={onClick}
      className="group rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-5 hover:border-[var(--border-strong)] transition-all cursor-pointer flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-9 w-9 rounded-[8px] border border-[var(--border)] bg-[var(--bg-subtle)] flex items-center justify-center shrink-0 text-[var(--text-secondary)] group-hover:text-[#1F4CC4] transition-colors">
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] leading-[20px] font-bold tracking-[-0.01em] text-[var(--text-primary)] truncate">
              {room.candidateName}
            </h3>
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)] truncate mt-0.5">
              {room.requirementTitle}
            </p>
          </div>
        </div>
        <Badge tone={statusTone}>{DEAL_ROOM_STATUS_LABELS[room.status]}</Badge>
      </div>

      <div className="pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-4 text-[12px] leading-[16px] text-[var(--text-secondary)]">
        {room.clientOrgName && (
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3 w-3 text-[var(--text-tertiary)]" />
            {room.clientOrgName}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-[var(--text-tertiary)]" />
          Opened {new Date(room.openedAt).toLocaleDateString()}
        </span>
        {room.status === 'closed' && room.closedAt && (
          <span className="inline-flex items-center gap-1.5 text-[var(--status-danger)]">
            <Lock className="h-3 w-3" />
            Closed {new Date(room.closedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Deal Room Detail View
// ---------------------------------------------------------------------------

const DealRoomDetailView: React.FC<{
  roomId: string;
  onBack: () => void;
}> = ({ roomId, onBack }) => {
  const { profile } = useAuth();
  const toast = useToastHelper();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('conversation');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['deal-room', roomId],
    queryFn: () => fetchDealRoom(roomId),
  });

  const isHq = profile?.role === 'admin' || profile?.role === 'recruiter';
  const isAdmin = profile?.role === 'admin';

  const tabs = useMemo(() => {
    const t = [
      { id: 'conversation', label: 'Conversation', count: data?.messages?.length },
      { id: 'participants', label: 'Participants', count: data?.participants?.length },
      { id: 'contact-requests', label: 'Contact Requests', count: data?.contactRequests?.length },
    ];
    if (isHq) {
      t.push({ id: 'audit', label: 'Activity Log', count: data?.auditEvents?.length });
    }
    if (isAdmin) {
      t.push({ id: 'admin', label: 'Admin Controls', count: undefined });
    }
    return t;
  }, [data, isHq, isAdmin]);

  if (isLoading) return <TableSkeleton rows={6} cols={4} />;
  if (error || !data) {
    return (
      <EmptyState
        title="Failed to load Deal Room"
        description={(error as Error)?.message || 'Room not found'}
        actionLabel="Go Back"
        onAction={onBack}
      />
    );
  }

  const { room, participants, messages, contactRequests, auditEvents } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="h-8 w-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
              {room.candidateName}
            </h1>
            <Badge tone={room.status === 'active' ? 'emerald' : 'slate'}>
              {DEAL_ROOM_STATUS_LABELS[room.status]}
            </Badge>
          </div>
          <p className="text-[13px] leading-[20px] text-[var(--text-secondary)] truncate">
            {room.requirementTitle}
            {room.clientOrgName ? ` · ${room.clientOrgName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[var(--bg-subtle)] border border-[var(--border)] text-[12px] text-[var(--text-secondary)]">
          <Shield className="h-3.5 w-3.5 text-[#1F4CC4]" />
          Identity Protected
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'conversation' && (
        <ConversationTab
          roomId={roomId}
          room={room}
          messages={messages}
          participants={participants}
          onRefresh={refetch}
        />
      )}
      {activeTab === 'participants' && (
        <ParticipantsTab
          roomId={roomId}
          participants={participants}
          isAdmin={!!isAdmin}
          onRefresh={refetch}
        />
      )}
      {activeTab === 'contact-requests' && (
        <ContactRequestsTab
          roomId={roomId}
          contactRequests={contactRequests}
          isAdmin={!!isAdmin}
          onRefresh={refetch}
        />
      )}
      {activeTab === 'audit' && isHq && (
        <AuditTab auditEvents={auditEvents} />
      )}
      {activeTab === 'admin' && isAdmin && (
        <AdminControlsTab
          roomId={roomId}
          room={room}
          onRefresh={refetch}
          onBack={onBack}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conversation Tab
// ---------------------------------------------------------------------------

const ConversationTab: React.FC<{
  roomId: string;
  room: DealRoom;
  messages: DealRoomMessage[];
  participants: DealRoomParticipant[];
  onRefresh: () => void;
}> = ({ roomId, room, messages, participants, onRefresh }) => {
  const { profile } = useAuth();
  const toast = useToastHelper();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [liveMessages, setLiveMessages] = useState<DealRoomMessage[]>(messages);
  const endRef = useRef<HTMLDivElement>(null);
  const latestTsRef = useRef<string>(
    messages.length > 0 ? messages[messages.length - 1].createdAt : new Date(0).toISOString()
  );

  useEffect(() => {
    setLiveMessages(messages);
    if (messages.length > 0) {
      latestTsRef.current = messages[messages.length - 1].createdAt;
    }
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveMessages]);

  // Poll for new messages every 5 seconds
  useEffect(() => {
    if (room.status === 'closed') return;

    const id = setInterval(async () => {
      try {
        const newMsgs = await pollMessages(roomId, latestTsRef.current);
        if (newMsgs.length > 0) {
          const maxTs = newMsgs[newMsgs.length - 1].createdAt;
          if (maxTs > latestTsRef.current) latestTsRef.current = maxTs;
          setLiveMessages((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            return [...prev, ...newMsgs.filter((m) => !ids.has(m.id))];
          });
        }
      } catch { /* silent */ }
    }, 5000);

    return () => clearInterval(id);
  }, [roomId, room.status]);

  const handleSend = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const msg = await sendMessage(roomId, draft.trim());
      if (msg.createdAt > latestTsRef.current) latestTsRef.current = msg.createdAt;
      setLiveMessages((prev) => [...prev, msg]);
      setDraft('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const isClosed = room.status === 'closed';
  const isHq = profile?.role === 'admin' || profile?.role === 'recruiter';

  return (
    <div className="flex flex-col gap-3">
      {/* Messages */}
      <Card className="p-0 overflow-hidden">
        <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
          {liveMessages.length === 0 && (
            <div className="text-center py-12 text-[13px] text-[var(--text-tertiary)]">
              No messages yet. Start the conversation.
            </div>
          )}
          {liveMessages.map((msg) => {
            const isOwn = msg.senderUserId === profile?.id;
            const isFlagged = msg.moderationStatus === 'flagged';
            const isBlocked = msg.moderationStatus === 'blocked';

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isOwn ? 'flex-row-reverse' : ''}`}
              >
                <Avatar
                  id={msg.senderUserId}
                  name={msg.senderDisplayLabel}
                  size="sm"
                />
                <div
                  className={`max-w-[70%] rounded-[8px] px-3 py-2 text-[13px] leading-[20px] ${
                    isOwn
                      ? 'bg-[#1F4CC4] text-white'
                      : 'bg-[var(--bg-subtle)] border border-[var(--border)] text-[var(--text-primary)]'
                  } ${isFlagged ? 'ring-2 ring-amber-400/50' : ''} ${
                    isBlocked ? 'ring-2 ring-red-400/50 opacity-60' : ''
                  }`}
                >
                  <div
                    className={`text-[11px] font-semibold mb-0.5 ${
                      isOwn ? 'text-white/75' : 'text-[var(--text-tertiary)]'
                    }`}
                  >
                    {msg.senderDisplayLabel}
                  </div>
                  <div>{msg.content}</div>
                  {isFlagged && isHq && (
                    <div className="mt-1 text-[11px] text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Flagged: external messaging reference
                    </div>
                  )}
                  {isBlocked && isHq && (
                    <div className="mt-1 text-[11px] text-red-300 flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      Blocked: {msg.moderationNote}
                    </div>
                  )}
                  <div
                    className={`text-[10px] mt-1 ${
                      isOwn ? 'text-white/50' : 'text-[var(--text-tertiary)]'
                    }`}
                  >
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </Card>

      {/* Message input */}
      {!isClosed && (
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSend();
                }
              }}
              placeholder="Type a message... (contact info is automatically blocked)"
              className="w-full h-[40px] rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 pr-10 text-[14px] leading-[20px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--focus-border)] focus:ring-[3px] focus:ring-[var(--focus-ring)]"
            />
          </div>
          <Button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            loading={sending}
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      )}

      {isClosed && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-[8px] bg-[var(--bg-subtle)] border border-[var(--border)] text-[13px] text-[var(--text-secondary)]">
          <Lock className="h-4 w-4" />
          This Deal Room is closed. Messages are read-only.
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Participants Tab
// ---------------------------------------------------------------------------

const ParticipantsTab: React.FC<{
  roomId: string;
  participants: DealRoomParticipant[];
  isAdmin: boolean;
  onRefresh: () => void;
}> = ({ roomId, participants, isAdmin, onRefresh }) => {
  const toast = useToastHelper();
  const [showAdd, setShowAdd] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addType, setAddType] = useState('client');
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    if (!addUserId.trim()) return;
    setBusy(true);
    try {
      await addParticipant(roomId, addUserId.trim(), addType);
      toast.success('Participant added');
      setShowAdd(false);
      setAddUserId('');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (participantId: string) => {
    if (!confirm('Remove this participant from the Deal Room?')) return;
    try {
      await removeParticipant(roomId, participantId);
      toast.success('Participant removed');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Add Participant
          </Button>
        </div>
      )}

      <Card className="divide-y divide-[var(--border)]">
        {participants.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar id={p.userId} name={p.displayLabel} />
              <div className="min-w-0">
                <div className="text-[13px] leading-[20px] font-medium text-[var(--text-primary)] truncate">
                  {p.displayLabel}
                </div>
                <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
                  {PARTICIPANT_TYPE_LABELS[p.participantType]}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={p.status === 'active' ? 'emerald' : 'slate'}>
                {p.status === 'active' ? 'Active' : 'Removed'}
              </Badge>
              {isAdmin && p.status === 'active' && (
                <button
                  type="button"
                  onClick={() => handleRemove(p.id)}
                  className="h-7 px-2 rounded-[6px] border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <UserMinus className="h-3 w-3" />
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        {participants.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
            No participants in this room yet.
          </div>
        )}
      </Card>

      <Dialog open={showAdd} onClose={() => setShowAdd(false)} title="Add Participant">
        <div className="space-y-4">
          <Input
            label="User ID"
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            placeholder="Enter user ID"
          />
          <Select
            label="Participant Type"
            value={addType}
            onChange={(e) => setAddType(e.target.value)}
            options={[
              { value: 'client', label: 'Client Representative' },
              { value: 'vendor', label: 'Vendor Representative' },
              { value: 'recruiter', label: 'HireNest Recruiter' },
              { value: 'admin', label: 'HireNest Admin' },
            ]}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} loading={busy} disabled={!addUserId.trim()}>
              Add Participant
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Contact Requests Tab
// ---------------------------------------------------------------------------

const ContactRequestsTab: React.FC<{
  roomId: string;
  contactRequests: ContactDetailRequest[];
  isAdmin: boolean;
  onRefresh: () => void;
}> = ({ roomId, contactRequests, isAdmin, onRefresh }) => {
  const toast = useToastHelper();
  const [showSubmit, setShowSubmit] = useState(false);
  const [contactType, setContactType] = useState<string>('candidate_email');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Respond dialog
  const [respondTo, setRespondTo] = useState<ContactDetailRequest | null>(null);
  const [respondStatus, setRespondStatus] = useState<'approved' | 'rejected'>('approved');
  const [disclosureChannel, setDisclosureChannel] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await submitContactRequest(roomId, contactType as ContactDetailRequest['contactType'], reason.trim());
      toast.success('Contact request submitted for admin review');
      setShowSubmit(false);
      setReason('');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRespond = async () => {
    if (!respondTo) return;
    setBusy(true);
    try {
      await respondToContactRequest(roomId, respondTo.id, respondStatus, disclosureChannel || undefined);
      toast.success(`Contact request ${respondStatus}`);
      setRespondTo(null);
      setDisclosureChannel('');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestStatusTone = (s: ContactRequestStatus) =>
    s === 'approved' ? 'emerald' : s === 'rejected' ? 'red' : 'amber';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--text-secondary)]">
          Request to share contact details through HireNest Admin. Direct sharing of contact info in messages is blocked.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setShowSubmit(true)}>
          <MailQuestion className="h-3.5 w-3.5" />
          Request Contact Details
        </Button>
      </div>

      <Card className="divide-y divide-[var(--border)]">
        {contactRequests.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
            No contact requests yet.
          </div>
        )}
        {contactRequests.map((cr) => (
          <div key={cr.id} className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  {cr.contactType.replace(/_/g, ' ')}
                </span>
                <Badge tone={requestStatusTone(cr.status)}>
                  {CONTACT_REQUEST_STATUS_LABELS[cr.status]}
                </Badge>
              </div>
              {isAdmin && cr.status === 'pending' && (
                <Button size="sm" variant="secondary" onClick={() => setRespondTo(cr)}>
                  <Eye className="h-3 w-3" />
                  Review
                </Button>
              )}
            </div>
            <p className="text-[12px] leading-[16px] text-[var(--text-secondary)]">
              Reason: {cr.reason}
            </p>
            {cr.respondedAt && (
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Responded {new Date(cr.respondedAt).toLocaleString()}
                {cr.disclosureChannel && ` · Via: ${cr.disclosureChannel}`}
              </p>
            )}
          </div>
        ))}
      </Card>

      {/* Submit Request Dialog */}
      <Dialog open={showSubmit} onClose={() => setShowSubmit(false)} title="Request Contact Details">
        <div className="space-y-4">
          <Select
            label="Contact Type"
            value={contactType}
            onChange={(e) => setContactType(e.target.value)}
            options={[
              { value: 'candidate_email', label: 'Candidate Email' },
              { value: 'candidate_phone', label: 'Candidate Phone' },
              { value: 'client_contact', label: 'Client Contact' },
              { value: 'vendor_contact', label: 'Vendor Contact' },
            ]}
          />
          <Textarea
            label="Reason for Request"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why you need this contact information..."
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowSubmit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={busy} disabled={!reason.trim()}>
              Submit Request
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Respond Dialog */}
      <Dialog
        open={!!respondTo}
        onClose={() => setRespondTo(null)}
        title="Review Contact Request"
      >
        {respondTo && (
          <div className="space-y-4">
            <div className="rounded-[8px] bg-[var(--bg-subtle)] border border-[var(--border)] p-3 text-[13px]">
              <div className="font-medium text-[var(--text-primary)]">
                {respondTo.contactType.replace(/_/g, ' ')}
              </div>
              <div className="text-[var(--text-secondary)] mt-1">{respondTo.reason}</div>
              <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                Requested by: {respondTo.requestedByName} · {new Date(respondTo.createdAt).toLocaleString()}
              </div>
            </div>
            <Select
              label="Decision"
              value={respondStatus}
              onChange={(e) => setRespondStatus(e.target.value as 'approved' | 'rejected')}
              options={[
                { value: 'approved', label: 'Approve' },
                { value: 'rejected', label: 'Reject' },
              ]}
            />
            {respondStatus === 'approved' && (
              <Input
                label="Disclosure Channel"
                value={disclosureChannel}
                onChange={(e) => setDisclosureChannel(e.target.value)}
                placeholder="e.g. Email, Phone call, In-app"
                hint="How will the contact info be shared?"
              />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setRespondTo(null)}>
                Cancel
              </Button>
              <Button
                variant={respondStatus === 'rejected' ? 'danger' : 'primary'}
                onClick={handleRespond}
                loading={busy}
              >
                {respondStatus === 'approved' ? 'Approve' : 'Reject'} Request
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Audit Tab
// ---------------------------------------------------------------------------

const AuditTab: React.FC<{
  auditEvents: DealRoomAuditEvent[];
}> = ({ auditEvents }) => {
  const sorted = useMemo(
    () => [...auditEvents].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [auditEvents]
  );

  return (
    <Card className="divide-y divide-[var(--border)]">
      {sorted.length === 0 && (
        <div className="px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
          No activity recorded yet.
        </div>
      )}
      {sorted.map((ev) => (
        <div key={ev.id} className="px-4 py-3 flex items-start gap-3">
          <div className="h-7 w-7 rounded-full bg-[var(--bg-subtle)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <History className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-[20px] text-[var(--text-primary)]">
              {AUDIT_EVENT_LABELS[ev.eventType] || ev.eventType}
            </div>
            <div className="text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              {ev.actorName} · {new Date(ev.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Admin Controls Tab
// ---------------------------------------------------------------------------

const AdminControlsTab: React.FC<{
  roomId: string;
  room: DealRoom;
  onRefresh: () => void;
  onBack: () => void;
}> = ({ roomId, room, onRefresh, onBack }) => {
  const toast = useToastHelper();
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);

  const handleClose = async () => {
    if (!closeReason.trim()) { toast.error('Please provide a reason'); return; }
    setBusy(true);
    try {
      await closeDealRoom(roomId, closeReason.trim());
      toast.success('Deal Room closed');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    setBusy(true);
    try {
      await reopenDealRoom(roomId);
      toast.success('Deal Room reopened');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Room Controls</h3>

        {room.status === 'active' && (
          <div className="space-y-3">
            <Textarea
              label="Closure Reason"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="e.g. Candidate placed, Negotiation concluded, etc."
            />
            <Button variant="danger" onClick={handleClose} loading={busy}>
              <Lock className="h-3.5 w-3.5" />
              Close Deal Room
            </Button>
          </div>
        )}

        {room.status === 'closed' && (
          <div className="space-y-3">
            <div className="rounded-[8px] bg-[var(--bg-subtle)] border border-[var(--border)] p-3 text-[13px]">
              <div className="font-medium text-[var(--text-primary)]">Closed</div>
              {room.closureReason && (
                <div className="text-[var(--text-secondary)] mt-1">Reason: {room.closureReason}</div>
              )}
              {room.closedAt && (
                <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                  {new Date(room.closedAt).toLocaleString()}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={handleReopen} loading={busy}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Reopen Deal Room
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">Room Information</h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <span className="text-[var(--text-tertiary)]">Submission ID</span>
            <p className="font-mono text-[12px] text-[var(--text-secondary)] truncate">{room.submissionId}</p>
          </div>
          <div>
            <span className="text-[var(--text-tertiary)]">Current Stage</span>
            <p className="text-[var(--text-secondary)]">{room.currentStage}</p>
          </div>
          <div>
            <span className="text-[var(--text-tertiary)]">Opened</span>
            <p className="text-[var(--text-secondary)]">{new Date(room.openedAt).toLocaleString()}</p>
          </div>
          <div>
            <span className="text-[var(--text-tertiary)]">Created By</span>
            <p className="text-[var(--text-secondary)]">{room.createdByName}</p>
          </div>
        </div>
      </Card>
    </div>
  );
};
