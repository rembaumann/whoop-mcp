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
  /** Absent or null while the member is still asleep. */
  end?: string | null;
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
  /** Absent while the member is still in this cycle. */
  end?: string | null;
  timezone_offset: string;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;
  score?: {
    strain?: number;
  };
  /**
   * Steps for this wake-to-wake cycle. Top-level on the cycle record (not inside `score`).
   * Null or omitted when Whoop has no step data. Never a stand-in for zero.
   * On the open cycle this is steps so far.
   */
  step_count?: number | null;
}

export interface WhoopCollection<T> {
  records?: T[];
  next_token?: string;
}

export interface WhoopZoneDurations {
  zone_zero_milli?: number | null;
  zone_one_milli?: number | null;
  zone_two_milli?: number | null;
  zone_three_milli?: number | null;
  zone_four_milli?: number | null;
  zone_five_milli?: number | null;
}

export interface WhoopWorkoutScore {
  strain?: number;
  average_heart_rate?: number;
  max_heart_rate?: number;
  kilojoule?: number;
  percent_recorded?: number;
  distance_meter?: number;
  altitude_gain_meter?: number;
  altitude_change_meter?: number;
  /** Official WorkoutScore field. */
  zone_durations?: WhoopZoneDurations | null;
  /** Occasional docs typo; only used if zone_durations is absent. */
  zone_duration?: WhoopZoneDurations | null;
}

export interface WhoopWorkout {
  id: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name?: string;
  /** Removed from the official schema after 2025-09-01. Present only if Whoop still sends it. */
  sport_id?: number | null;
  score_state: "SCORED" | "PENDING_SCORE" | "UNSCORABLE" | string;
  score?: WhoopWorkoutScore;
}

