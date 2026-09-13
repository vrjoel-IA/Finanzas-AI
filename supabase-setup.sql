-- Esquema completo de Finanzas Pro AI.
--
-- Se puede ejecutar entero y las veces que haga falta: todo es idempotente, asi
-- que no rompe nada si las tablas ya existen.
--
-- Pegar en el editor SQL de Supabase y pulsar Run.

-- ---------------------------------------------------------------------------
-- 1. Estado actual del usuario
-- ---------------------------------------------------------------------------
-- Una fila por usuario. Cada guardado hace UPDATE sobre la misma celda, asi que
-- esta tabla NO conserva el pasado: para eso esta profile_versions.

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  state       jsonb,
  updated_at  timestamptz
);

alter table profiles enable row level security;

drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile" on profiles
  for select using ( auth.uid() = id );

drop policy if exists "Users can insert their own profile" on profiles;
create policy "Users can insert their own profile" on profiles
  for insert with check ( auth.uid() = id );

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles
  for update using ( auth.uid() = id );

-- ---------------------------------------------------------------------------
-- 2. Historial de versiones
-- ---------------------------------------------------------------------------
-- Por que existe: el 13/09/2026 la app sobrescribio el estado de un usuario con
-- los datos de ejemplo. Como `profiles` solo guarda el valor actual, la version
-- anterior dejo de existir en el instante en que se escribio la nueva, y sin
-- copias en plan gratuito no hubo nada que restaurar.
--
-- Esta tabla solo admite INSERT. Cada guardado relevante anade una fila nueva.

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

drop policy if exists "Users can read own versions" on profile_versions;
create policy "Users can read own versions" on profile_versions
  for select using ( auth.uid() = user_id );

drop policy if exists "Users can insert own versions" on profile_versions;
create policy "Users can insert own versions" on profile_versions
  for insert with check ( auth.uid() = user_id );

-- DELIBERADAMENTE NO HAY POLITICAS DE UPDATE NI DELETE.
-- Una version, una vez escrita, es inmutable: la aplicacion no puede tocarla ni
-- aunque tenga un fallo. Poder sobrescribir el pasado es justo lo que hizo
-- irrecuperable la perdida de datos.

-- La retencion la hace el servidor, no el cliente: se conservan las 60 ultimas
-- versiones por usuario. Al ser SECURITY DEFINER se ejecuta con los permisos del
-- propietario de la tabla, de modo que nadie puede usarla para borrar a medida.
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

-- ---------------------------------------------------------------------------
-- 3. Comprobacion
-- ---------------------------------------------------------------------------
-- Deberia devolver las dos tablas y, en profile_versions, solo select e insert.

select tablename,
       string_agg(cmd, ', ' order by cmd) as permisos
  from pg_policies
 where tablename in ('profiles', 'profile_versions')
 group by tablename;
