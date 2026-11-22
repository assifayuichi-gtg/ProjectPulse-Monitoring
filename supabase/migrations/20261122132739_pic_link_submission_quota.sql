alter table public.projectpulse_pic_links
  add column max_submissions integer not null default 1 check (max_submissions between 1 and 14),
  add column submission_count integer not null default 0 check (submission_count between 0 and max_submissions);
update public.projectpulse_pic_links set submission_count=1 where submitted_at is not null;
create unique index projectpulse_one_repeat_link_per_pic on public.projectpulse_pic_links (lower(btrim(pic_name))) where max_submissions>1 and revoked_at is null;
create or replace function public.projectpulse_commit_pic_workflow(p_hash text, p_payload jsonb, p_expected_revision bigint)
returns jsonb language plpgsql set search_path to '' as $function$
declare
  link public.projectpulse_pic_links%rowtype;
  saved_revision bigint;
begin
  select * into link from public.projectpulse_pic_links where token_hash=p_hash for update;
  if not found or link.expires_at <= clock_timestamp() or link.revoked_at is not null then
    return jsonb_build_object('unavailable',true);
  end if;
  if link.submission_count >= link.max_submissions then
    return jsonb_build_object('submitted',true);
  end if;
  if link.max_submissions > 1 and link.submitted_at > clock_timestamp() - interval '60 seconds' then
    return jsonb_build_object('cooldown',true);
  end if;
  perform set_config('projectpulse.audit_actor',link.pic_name,true);
  perform set_config('projectpulse.audit_kind','pic',true);
  select saved.revision into saved_revision from public.projectpulse_put_state(p_payload,p_expected_revision) saved;
  if not found then return jsonb_build_object('conflict',true); end if;
  update public.projectpulse_pic_links set submitted_at=clock_timestamp(), submission_count=link.submission_count+1 where id=link.id;
  return jsonb_build_object('ok',true,'revision',saved_revision,'remaining',link.max_submissions-link.submission_count-1);
end;
$function$;