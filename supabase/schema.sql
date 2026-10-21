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

-- v2: Kalendarium (meses 1-12) y nombre en latín vulgar / otros nombres
alter table public.plants add column if not exists flower_months int[] default '{}';
alter table public.plants add column if not exists fruit_months  int[] default '{}';
alter table public.plants add column if not exists other_names   text;

-- v3: origen y distribución (uso global)
alter table public.plants add column if not exists native_range text;

-- v4: estado de conservación global (Lista Roja UICN) en lugar de la rareza local
alter table public.plants add column if not exists iucn text;

-- v5: origen corto para la ficha técnica
alter table public.plants add column if not exists origin text;

-- v6: usos de la planta {comer|medicina|toxica|otro: {partes: [hoja|flor|fruto|semilla|raiz|tallo], nota}}
alter table public.plants add column if not exists parts jsonb default '{}'::jsonb;

-- v7: usos medicinales separados de comestibilidad y otros usos
alter table public.plants add column if not exists medicinal_notes text;

-- v8: herbario compartible. Todos los usuarios de esta nube ven todas las láminas y fotos;
-- cada uno crea, edita y borra solo lo suyo. Solo entran quienes des de alta en Authentication → Users.
alter table public.plants add column if not exists author_name text;
drop policy if exists "own plants" on public.plants;
drop policy if exists "read shared" on public.plants;
drop policy if exists "insert own" on public.plants;
drop policy if exists "update own" on public.plants;
drop policy if exists "delete own" on public.plants;
create policy "read shared" on public.plants for select to authenticated using (true);
create policy "insert own" on public.plants for insert to authenticated with check (auth.uid() = user_id);
create policy "update own" on public.plants for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own" on public.plants for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "own photos" on storage.objects;
drop policy if exists "read photos" on storage.objects;
drop policy if exists "write own photos" on storage.objects;
drop policy if exists "update own photos" on storage.objects;
drop policy if exists "delete own photos" on storage.objects;
create policy "read photos" on storage.objects for select to authenticated using (bucket_id = 'plant-photos');
create policy "write own photos" on storage.objects for insert to authenticated with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own photos" on storage.objects for update to authenticated using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own photos" on storage.objects for delete to authenticated using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- v9: hallazgos repetidos de una misma especie (otra persona u otra salida) sin duplicar la lámina
create table if not exists public.sightings (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author_name text, photos text[] default '{}', found_at date, location_name text,
  lat double precision, lng double precision, created_at timestamptz default now()
);
alter table public.sightings enable row level security;
drop policy if exists "read sightings" on public.sightings;
drop policy if exists "insert own sightings" on public.sightings;
drop policy if exists "delete own sightings" on public.sightings;
create policy "read sightings" on public.sightings for select to authenticated using (true);
create policy "insert own sightings" on public.sightings for insert to authenticated with check (auth.uid() = user_id);
create policy "delete own sightings" on public.sightings for delete to authenticated using (auth.uid() = user_id);
