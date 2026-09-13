-- Historial de versiones del estado.
--
-- Por que existe: el 13/09/2026 la app sobrescribio el estado de un usuario con
-- los datos de ejemplo. La tabla `profiles` guarda una fila por usuario y cada
-- guardado hace UPDATE sobre la misma celda, asi que la version anterior dejo de
-- existir en el instante en que se escribio la nueva. Sin copias en plan
-- gratuito, no hubo nada que restaurar.
--
-- Esta tabla solo admite INSERT. Cada guardado relevante anade una fila nueva en
-- lugar de pisar la anterior.
--
-- Ejecutar una vez en el editor SQL de Supabase.

create table if not exists profile_versions (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  state       jsonb not null,
  tx_count    integer not null default 0,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists profile_versions_user_created_idx
  on profile_versions (user_id, created_at desc);

alter table profile_versions enable row level security;

-- Cada usuario ve y escribe solo su historial.
drop policy if exists "Users can read own versions" on profile_versions;
create policy "Users can read own versions" on profile_versions
  for select using ( auth.uid() = user_id );

drop policy if exists "Users can insert own versions" on profile_versions;
create policy "Users can insert own versions" on profile_versions
  for insert with check ( auth.uid() = user_id );

-- DELIBERADAMENTE NO HAY POLITICAS DE UPDATE NI DELETE.
-- Una version, una vez escrita, es inmutable y la aplicacion no puede tocarla.
-- Ese es justamente el fallo que hizo irrecuperable la perdida de datos.

-- La retencion la hace el servidor, no la app: se conservan las 60 ultimas
-- versiones por usuario. Al ser SECURITY DEFINER, se ejecuta con los permisos
-- del propietario de la tabla y no con los del cliente, de modo que nadie puede
-- usarla para borrar lo que le convenga.
create or replace function prune_profile_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from profile_versions
   where user_id = new.user_id
     and id not in (
       select id from profile_versions
        where user_id = new.user_id
        order by created_at desc
        limit 60
     );
  return null;
end;
$$;

drop trigger if exists profile_versions_prune on profile_versions;
create trigger profile_versions_prune
  after insert on profile_versions
  for each row execute function prune_profile_versions();
