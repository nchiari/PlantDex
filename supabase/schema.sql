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

-- v10: ¿sos el dueño del herbario? (el primer usuario de esta nube). La app oculta los datos de conexión a los demás.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and auth.uid() = (select id from auth.users order by created_at asc limit 1);
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- v11: salir del herbario (solo invitados). Borra la cuenta de quien sale; si elige llevarse sus láminas, se borran
-- las que nadie más encontró. Las demás láminas y sus hallazgos pasan al dueño, con su firma intacta.
create or replace function public.leave_herbarium(take_mine boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); boss uuid; base int;
begin
  if me is null then raise exception 'sin sesión'; end if;
  select id into boss from auth.users order by created_at asc limit 1;
  if me = boss then raise exception 'el dueño no puede salir de su propio herbario'; end if;
  if take_mine then
    delete from public.plants p where p.user_id = me
      and not exists (select 1 from public.sightings s where s.plant_id = p.id and s.user_id <> me);
  end if;
  select coalesce(max(number), 0) into base from public.plants where user_id = boss;
  update public.plants p set user_id = boss, number = base + r.rn
    from (select id, row_number() over (order by number) as rn from public.plants where user_id = me) r where p.id = r.id;
  update public.sightings set user_id = boss where user_id = me;
  delete from auth.users where id = me;
end $$;
revoke all on function public.leave_herbarium(boolean) from public, anon;
grant execute on function public.leave_herbarium(boolean) to authenticated;

-- v12: cada uno puede editar sus hallazgos (por ejemplo, borrar una foto propia).
drop policy if exists "update own sightings" on public.sightings;
create policy "update own sightings" on public.sightings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- v13: pedidos para entrar. Cualquiera puede crear su cuenta desde una invitación, pero solo ve y toca el herbario
-- cuando el dueño la acepta. Las cuentas que ya existían quedan aceptadas.
create table if not exists public.members (
  user_id uuid primary key references auth.users on delete cascade,
  email text, name text, invited_by text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz default now(), decided_at timestamptz
);
alter table public.members enable row level security;
insert into public.members (user_id, email, name, status, decided_at)
  select id, email, nullif(raw_user_meta_data->>'name', ''), 'accepted', now() from auth.users
  on conflict (user_id) do nothing;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (public.is_owner()
    or exists (select 1 from public.members m where m.user_id = auth.uid() and m.status = 'accepted'));
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Cada cuenta nueva entra como pedido pendiente, con el nombre y quién la invitó (vienen de la app al pedir el link).
create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (user_id, email, name, invited_by)
  values (new.id, new.email, nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'invited_by', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.on_new_user();

drop policy if exists "read own or owner" on public.members;
drop policy if exists "owner decides" on public.members;
create policy "read own or owner" on public.members for select to authenticated using (user_id = auth.uid() or public.is_owner());
create policy "owner decides" on public.members for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Láminas, hallazgos y fotos: solo para miembros aceptados.
drop policy if exists "read shared" on public.plants;
drop policy if exists "insert own" on public.plants;
drop policy if exists "update own" on public.plants;
drop policy if exists "delete own" on public.plants;
create policy "read shared" on public.plants for select to authenticated using (public.is_member());
create policy "insert own" on public.plants for insert to authenticated with check (auth.uid() = user_id and public.is_member());
create policy "update own" on public.plants for update to authenticated using (auth.uid() = user_id and public.is_member()) with check (auth.uid() = user_id);
create policy "delete own" on public.plants for delete to authenticated using (auth.uid() = user_id and public.is_member());
drop policy if exists "read sightings" on public.sightings;
drop policy if exists "insert own sightings" on public.sightings;
drop policy if exists "update own sightings" on public.sightings;
drop policy if exists "delete own sightings" on public.sightings;
create policy "read sightings" on public.sightings for select to authenticated using (public.is_member());
create policy "insert own sightings" on public.sightings for insert to authenticated with check (auth.uid() = user_id and public.is_member());
create policy "update own sightings" on public.sightings for update to authenticated using (auth.uid() = user_id and public.is_member()) with check (auth.uid() = user_id);
create policy "delete own sightings" on public.sightings for delete to authenticated using (auth.uid() = user_id and public.is_member());
drop policy if exists "read photos" on storage.objects;
drop policy if exists "write own photos" on storage.objects;
create policy "read photos" on storage.objects for select to authenticated using (bucket_id = 'plant-photos' and public.is_member());
create policy "write own photos" on storage.objects for insert to authenticated with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());

-- v14: número de versión de la base. La app lo compara con el que necesita y, si falta algo,
-- le muestra al dueño un aviso con este archivo para correr (se puede correr entero de nuevo sin riesgo).
create or replace function public.schema_version() returns int language sql immutable as $$ select 14 $$;
grant execute on function public.schema_version() to anon, authenticated;

-- v15: nombres de las personas aceptadas en el herbario (para los filtros, aunque todavía no hayan cargado nada).
-- Usa el nombre actual de cada cuenta; solo lo pueden pedir los miembros.
create or replace function public.member_names() returns setof text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(u.raw_user_meta_data->>'name', ''), m.name)
  from public.members m join auth.users u on u.id = m.user_id
  where m.status = 'accepted' and public.is_member()
    and coalesce(nullif(u.raw_user_meta_data->>'name', ''), m.name) is not null;
$$;
revoke all on function public.member_names() from public, anon;
grant execute on function public.member_names() to authenticated;
create or replace function public.schema_version() returns int language sql immutable as $$ select 15 $$;

-- v16: avisos (notificación en el celular y mail). Cada persona elige en Ajustes qué quiere recibir y por dónde.
-- Los celulares que aceptaron recibir avisos; cada uno ve y borra solo los suyos.
create table if not exists public.push_subs (
  endpoint text primary key, user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null, auth text not null, created_at timestamptz default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own subs read" on public.push_subs;
drop policy if exists "own subs write" on public.push_subs;
drop policy if exists "own subs delete" on public.push_subs;
create policy "own subs read" on public.push_subs for select to authenticated using (user_id = auth.uid());
create policy "own subs write" on public.push_subs for insert to authenticated with check (user_id = auth.uid());
create policy "own subs delete" on public.push_subs for delete to authenticated using (user_id = auth.uid());
-- Qué avisos quiere cada persona (de entrada: celular sí, mail no), su zona horaria y cuándo se le avisó por última vez.
create table if not exists public.notif_prefs (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  prefs jsonb not null default '{"requests":{"push":true,"mail":false},"members":{"push":true,"mail":false},"plants":{"push":true,"mail":false},"missions":{"push":true,"mail":false}}',
  tz text default 'Europe/Madrid', last_mission_ping date, last_digest_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.notif_prefs enable row level security;
drop policy if exists "own prefs read" on public.notif_prefs;
drop policy if exists "own prefs write" on public.notif_prefs;
drop policy if exists "own prefs update" on public.notif_prefs;
create policy "own prefs read" on public.notif_prefs for select to authenticated using (user_id = auth.uid());
create policy "own prefs write" on public.notif_prefs for insert to authenticated with check (user_id = auth.uid());
create policy "own prefs update" on public.notif_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Para no avisar dos veces el mismo pedido.
alter table public.members add column if not exists notified_at timestamptz;
-- Claves que solo usa la función de avisos (sin reglas de acceso: nadie las lee desde la app).
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
-- Además hacen falta la función "notify" (supabase/functions/notify), el secreto BREVO_API_KEY para los mails
-- y una tarea que la llame cada hora (para la misión nueva de las 9 y el resumen diario de láminas):
--   create extension if not exists pg_cron; create extension if not exists pg_net;
--   select cron.schedule('herbalorium-avisos', '5 * * * *', $c$ select net.http_post(url := 'https://<proyecto>.supabase.co/functions/v1/notify',
--     headers := jsonb_build_object('content-type','application/json','x-cron', (select value from public.app_secrets where key = 'cron')), body := '{"kind":"cron"}'::jsonb) $c$);
create or replace function public.schema_version() returns int language sql immutable as $$ select 16 $$;

-- v17: nombres y fecha de entrada de las personas aceptadas (para «Quiénes están»). Solo para miembros, sin emails.
create or replace function public.member_list() returns table(name text, joined date)
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(u.raw_user_meta_data->>'name', ''), m.name), coalesce(m.decided_at, u.created_at)::date
  from public.members m join auth.users u on u.id = m.user_id
  where m.status = 'accepted' and public.is_member()
    and coalesce(nullif(u.raw_user_meta_data->>'name', ''), m.name) is not null;
$$;
revoke all on function public.member_list() from public, anon;
grant execute on function public.member_list() to authenticated;
create or replace function public.schema_version() returns int language sql immutable as $$ select 17 $$;

-- v18: hallada (afuera) o cultivada (en casa). Las cultivadas no guardan el lugar.
alter table public.plants add column if not exists setting text check (setting in ('hallada', 'cultivada'));
create or replace function public.schema_version() returns int language sql immutable as $$ select 18 $$;

-- v19: expediciones del herbario. Cada dos semanas, una meta entre todos (sábado 9:00 → domingo de la semana siguiente).
-- Rasgos invisibles de cada lámina que pide el prompt (color de flor, fruto, espinas, olor): sirven para armar expediciones.
alter table public.plants add column if not exists traits jsonb;

-- Plantillas: de acá sale cada expedición nueva, en orden y sin repetir en 6 meses. rule dice qué lámina cuenta:
--   {"type":"arbol"} · {"trait":"flower_color","any":["amarillo"]} · {"trait":"spines"} · {"setting":"hallada"}
--   {"new":true} (solo láminas nuevas) · {"sighting":true} (solo sumar tu hallazgo a la lámina de otro)
create table if not exists public.expedition_templates (
  key text primary key, title text not null, hint text not null, icon text not null, rule jsonb not null,
  goal int not null, needs_trait text, position int not null default 100, active boolean not null default true
);
alter table public.expedition_templates enable row level security;
drop policy if exists "read templates" on public.expedition_templates;
drop policy if exists "owner edits templates" on public.expedition_templates;
create policy "read templates" on public.expedition_templates for select to authenticated using (public.is_member());
create policy "owner edits templates" on public.expedition_templates for update to authenticated using (public.is_owner()) with check (public.is_owner());
insert into public.expedition_templates (key, title, hint, icon, rule, goal, needs_trait, position) values
  ('arboles', 'Árboles del barrio', 'Tienen un tronco grueso y son más altos que vos. Los de la vereda y la plaza cuentan.', 'f-tree', '{"type":"arbol"}', 5, null, 1),
  ('pinchan', 'Las que pinchan', 'Espinas o pinchos en el tallo o en las hojas: rosales, cactus, zarzamoras. Mirá sin tocar.', 'f-thorn', '{"trait":"spines"}', 4, 'spines', 2),
  ('olor', 'Huele rico', 'Frotá suavemente una hoja entre los dedos u olé la flor. Si deja olor, cuenta.', 'f-flower', '{"trait":"scent"}', 4, 'scent', 3),
  ('amarillas', 'Flores amarillas', 'Cualquier planta con flores amarillas: en canteros, baldíos o entre las baldosas.', 'f-flower', '{"trait":"flower_color","any":["amarillo"]}', 3, 'flower_color', 4),
  ('casa', 'Plantas de casa', 'Las que viven en macetas, balcones, huertas o jardines: las tuyas, las de tu familia o las de un vecino.', 'f-pot', '{"setting":"cultivada"}', 4, null, 5),
  ('trepan', 'Las que trepan', 'Plantas que suben por paredes, rejas o árboles, agarradas con zarcillos o enroscadas.', 'f-herb', '{"type":"trepadora"}', 3, null, 6),
  ('blancas', 'Flores blancas', 'Flores blancas, grandes o chiquitas. Fijate también en arbustos y árboles en flor.', 'f-flower', '{"trait":"flower_color","any":["blanco"]}', 3, 'flower_color', 7),
  ('barrio', 'Sin salir del barrio', 'Cualquier planta que encuentres afuera, a pocas cuadras de casa.', 'f-pin', '{"setting":"hallada"}', 6, null, 8),
  ('rojas', 'Flores rojas y naranjas', 'Las que se ven de lejos: rojo, naranja, coral.', 'f-flower', '{"trait":"flower_color","any":["rojo","naranja"]}', 3, 'flower_color', 9),
  ('frutos', 'Frutos a la vista', 'Bayas, vainas, piñas, bellotas o frutas colgando: cualquier fruto que se vea.', 'f-fruit', '{"trait":"fruit"}', 4, 'fruit', 10),
  ('nuevas', 'Nuevas para el herbario', 'Plantas que todavía nadie cargó. Mirá el herbario antes de salir.', 'f-herb', '{"new":true}', 4, null, 11),
  ('rosas', 'Flores rosas', 'Del rosa clarito al fucsia.', 'f-flower', '{"trait":"flower_color","any":["rosa"]}', 3, 'flower_color', 12),
  ('hongos', 'Hongos y setas', 'Después de la lluvia, en el pasto, en troncos o al pie de los árboles. Mirá, no toques.', 'f-mushroom', '{"type":"hongo"}', 2, null, 13),
  ('violetas', 'Flores violetas y azules', 'Lilas, violetas, celestes y azules. Suelen ser más chiquitas: mirá de cerca.', 'f-flower', '{"trait":"flower_color","any":["violeta","azul"]}', 3, 'flower_color', 14),
  ('doble', 'Doble hallazgo', 'Buscá afuera alguna planta que ya cargó otra persona y sumá tu hallazgo a su lámina.', 'f-family', '{"sighting":true}', 4, null, 15)
on conflict (key) do update set title = excluded.title, hint = excluded.hint, icon = excluded.icon, rule = excluded.rule,
  goal = excluded.goal, needs_trait = excluded.needs_trait, position = excluded.position;

-- Expediciones (las de prueba, demo = true, solo las ve y las toca el dueño) y sus casilleros llenos.
create table if not exists public.expeditions (
  id uuid primary key default gen_random_uuid(), template text, title text not null, hint text, icon text, rule jsonb not null,
  goal int not null, starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'done', 'expired')),
  completed_at timestamptz, reminded_at timestamptz, demo boolean not null default false, created_at timestamptz default now()
);
create unique index if not exists expeditions_one_active on public.expeditions (demo) where status = 'active';
create table if not exists public.expedition_entries (
  expedition_id uuid not null references public.expeditions on delete cascade,
  plant_id uuid not null references public.plants on delete cascade,
  user_id uuid references auth.users on delete set null, author_name text, created_at timestamptz default now(),
  primary key (expedition_id, plant_id)
);
alter table public.expeditions enable row level security;
alter table public.expedition_entries enable row level security;
drop policy if exists "read expeditions" on public.expeditions;
drop policy if exists "owner demo expeditions" on public.expeditions;
drop policy if exists "read entries" on public.expedition_entries;
drop policy if exists "owner demo entries" on public.expedition_entries;
create policy "read expeditions" on public.expeditions for select to authenticated using (public.is_member() and (not demo or public.is_owner()));
create policy "owner demo expeditions" on public.expeditions for all to authenticated using (demo and public.is_owner()) with check (demo and public.is_owner());
create policy "read entries" on public.expedition_entries for select to authenticated
  using (exists (select 1 from public.expeditions e where e.id = expedition_id and public.is_member() and (not e.demo or public.is_owner())));
create policy "owner demo entries" on public.expedition_entries for all to authenticated
  using (exists (select 1 from public.expeditions e where e.id = expedition_id and e.demo and public.is_owner()))
  with check (exists (select 1 from public.expeditions e where e.id = expedition_id and e.demo and public.is_owner()));

-- ¿Esta lámina cuenta para esta regla? (sighting = se sumó como hallazgo a la lámina de otra persona)
create or replace function public.expedition_match(r jsonb, p public.plants, sighting boolean) returns boolean
language sql stable set search_path = '' as $$
  select case
    when r ? 'sighting' then sighting
    when r ? 'new' then not sighting
    when r ? 'type' then coalesce(p.types, '{}') @> array[r->>'type']
    when r ? 'setting' then coalesce(p.setting, 'hallada') = r->>'setting'
    when r ? 'trait' and r ? 'any' then exists (select 1 from jsonb_array_elements_text(coalesce(p.traits->(r->>'trait'), '[]'::jsonb)) c where r->'any' ? c)
    when r ? 'trait' then coalesce((p.traits->>(r->>'trait'))::boolean, false)
    else false end;
$$;

-- Llena el casillero de la expedición activa (la real) cuando alguien asienta una lámina o suma su hallazgo.
create or replace function public.expedition_count(pid uuid, uid uuid, who text, sighting boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.expeditions; p public.plants; n int;
begin
  select * into e from public.expeditions where status = 'active' and not demo and now() between starts_at and ends_at limit 1;
  if not found then return; end if;
  select * into p from public.plants where id = pid;
  if not found or not public.expedition_match(e.rule, p, sighting) then return; end if;
  insert into public.expedition_entries (expedition_id, plant_id, user_id, author_name) values (e.id, pid, uid, who) on conflict do nothing;
  select count(*) into n from public.expedition_entries where expedition_id = e.id;
  if n >= e.goal then update public.expeditions set status = 'done', completed_at = now() where id = e.id and status = 'active'; end if;
end $$;
revoke all on function public.expedition_count(uuid, uuid, text, boolean) from public, anon, authenticated;
create or replace function public.on_plant_expedition() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.expedition_count(new.id, new.user_id, new.author_name, false); return new; end $$;
create or replace function public.on_sighting_expedition() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.plants where id = new.plant_id and user_id <> new.user_id)
    and not exists (select 1 from public.sightings where plant_id = new.plant_id and user_id = new.user_id and id <> new.id) then
    perform public.expedition_count(new.plant_id, new.user_id, new.author_name, true);
  end if;
  return new;
end $$;
drop trigger if exists plant_expedition on public.plants;
create trigger plant_expedition after insert on public.plants for each row execute function public.on_plant_expedition();
drop trigger if exists sighting_expedition on public.sightings;
create trigger sighting_expedition after insert on public.sightings for each row execute function public.on_sighting_expedition();
create or replace function public.schema_version() returns int language sql immutable as $$ select 19 $$;
