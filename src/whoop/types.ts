/**
 * Types for the WHOOP Developer API v2.
 *
 * Field names match the public OpenAPI document:
 * https://api.prod.whoop.com/developer/doc/openapi.json
 * Human-readable reference: https://developer.whoop.com/api
 */

export type ScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE";

export interface UserBasicProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface UserBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

export interface CycleScore {
  strain: number;
  kilojoule: number;
  average_heart_rate: number;
  max_heart_rate: number;
}

export interface Cycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  /** Absent while the user is still in this physiological cycle. */
  end?: string;
  timezone_offset: string;
  score_state: ScoreState;
  /** Present when score_state is SCORED. Strain is 0–21. */
  score?: CycleScore;
  /** Null when the device was not worn for the full cycle. */
  step_count?: number | null;
}

export interface RecoveryScore {
  user_calibrating: boolean;
  /** 0–100. How prepared the body is to take on strain. */
  recovery_score: number;
  resting_heart_rate: number;
  /** Heart-rate variability (RMSSD), in milliseconds. */
  hrv_rmssd_milli: number;
  /** Present on WHOOP 4.0 and newer. */
  spo2_percentage?: number;
  /** Skin temperature in Celsius. Present on WHOOP 4.0 and newer. */
  skin_temp_celsius?: number;
}

export interface Recovery {
  cycle_id: number;
  sleep_id: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: ScoreState;
  score?: RecoveryScore;
}

export interface SleepStageSummary {
  total_in_bed_time_milli: number;
  total_awake_time_milli: number;
  total_no_data_time_milli: number;
  total_light_sleep_time_milli: number;
  total_slow_wave_sleep_time_milli: number;
  total_rem_sleep_time_milli: number;
  sleep_cycle_count: number;
  disturbance_count: number;
}

export interface SleepNeeded {
  baseline_milli: number;
  need_from_sleep_debt_milli: number;
  need_from_recent_strain_milli: number;
  /** Zero or negative. Naps reduce sleep need. */
  need_from_recent_nap_milli: number;
}

export interface SleepScore {
  stage_summary: SleepStageSummary;
  sleep_needed: SleepNeeded;
  respiratory_rate?: number;
  /** 0–100. Asleep time compared with sleep needed. */
  sleep_performance_percentage?: number;
  /** 0–100. Similarity of sleep and wake times to the previous day. */
  sleep_consistency_percentage?: number;
  /** 0–100. Portion of time in bed actually spent asleep. */
  sleep_efficiency_percentage?: number;
}

export interface Sleep {
  id: string;
  cycle_id: number;
  /** Legacy id. WHOOP documents that it will not exist past 2025-09-01. */
  v1_id?: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: ScoreState;
  score?: SleepScore;
}

export interface ZoneDurations {
  zone_zero_milli: number;
  zone_one_milli: number;
  zone_two_milli: number;
  zone_three_milli: number;
  zone_four_milli: number;
  zone_five_milli: number;
}

export interface WorkoutScore {
  /** 0–21. */
  strain: number;
  average_heart_rate: number;
  max_heart_rate: number;
  kilojoule: number;
  /** 0–100. Portion of the workout for which heart-rate data was received. */
  percent_recorded: number;
  distance_meter?: number;
  altitude_gain_meter?: number;
  altitude_change_meter?: number;
  zone_durations: ZoneDurations;
}

export interface Workout {
  id: string;
  v1_id?: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_name: string;
  score_state: ScoreState;
  score?: WorkoutScore;
  /** Legacy sport id. WHOOP documents that it will not exist past 2025-09-01. */
  sport_id?: number;
}

export interface Paginated<T> {
  records?: T[];
  /** Absent when this is the last page. Pass it back as next_token. */
  next_token?: string;
}

export interface CollectionQuery {
  /** WHOOP maximum is 25. Default on the API is 10. */
  limit?: number;
  /** Inclusive. ISO-8601 date-time. */
  start?: string;
  /** Exclusive. ISO-8601 date-time. WHOOP defaults this to now. */
  end?: string;
  /** Value of next_token from the previous page. Sent as nextToken. */
  nextToken?: string;
}
