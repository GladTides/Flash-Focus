grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.competitions,
  public.participant_profiles,
  public.game_sessions,
  public.leaderboard_entries
to service_role;