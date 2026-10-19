-- PlantDex · esquema de Supabase
-- Pegalo entero en Supabase → SQL Editor → New query → Run.

create table if not exists public.plants (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  number          int  not null,
  common_name     text not null,
  scientific_name text,
  family          text,
  kind            text,          -- árbol, arbusto, hierba, trepadora, hongo...
  types           text[] default '{}',
  edible_human    text,          -- si / parcial / no / desconocido
  dog_safety      text,          -- seguro / precaucion / toxico / desconocido
  description     text,
  edibility_notes text,
  dog_notes       text,
  uses            text,
  history         text,
  curiosity       text,
  rarity          int default 1, -- 1 a 5
  notes           text,
  location_name   text,
  lat             double precision,
  lng             double precision,
  found_at        date default current_date,
  photos          text[] default '{}',
  ai_confidence   text,
  created_at      timestamptz default now(),
  unique (user_id, number)
);

alter table public.plants enable row level security;

drop policy if exists "own plants" on public.plants;
create policy "own plants" on public.plants
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Bucket privado para las fotos
insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos" on storage.objects;
create policy "own photos" on storage.objects
  for all using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
