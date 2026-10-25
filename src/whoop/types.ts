export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: string;
  created_at: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;
  score?: {
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
  };
}

export interface WhoopSleep {
  id: string;
  cycle_id?: number;
  start: string;
  end: string;
  timezone_offset: string;
  nap?: boolean;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;
  score?: {
    sleep_performance_percentage?: number;
  };
}

export interface WhoopCycle {
  id: number;
  start: string;
  end?: string;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;
  score?: {
    strain?: number;
  };
}

export interface WhoopCollection<T> {
  records?: T[];
  next_token?: string;
}
