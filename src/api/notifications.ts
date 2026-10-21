import { supabase } from '../lib/supabase';
import type { NotificationItem } from '../types/db';

const DEFAULT_PAGE_SIZE = 25;

export async function fetchNotifications(params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ data: NotificationItem[]; count: number; unreadCount: number }> {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || DEFAULT_PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const [{ data, error, count }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null),
  ]);

  if (error) throw error;
  return {
    data: (data || []) as NotificationItem[],
    count: count || 0,
    unreadCount: unreadCount || 0,
  };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
}
