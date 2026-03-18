-- Create a table for public profiles
create table profiles (
  id uuid references auth.users not null primary key,
  state jsonb,
  updated_at timestamp with time zone
);

-- Set up Row Level Security (RLS)
alter table profiles enable row level security;

create policy "Users can view own profile" on profiles
  for select using ( auth.uid() = id );

create policy "Users can insert their own profile" on profiles
  for insert with check ( auth.uid() = id );

create policy "Users can update own profile" on profiles
  for update using ( auth.uid() = id );
