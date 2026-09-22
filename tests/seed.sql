-- Jeu de données utilisé par la suite E2E (tests/run.sh --full).
-- Chargé par psql avec ON_ERROR_STOP=1 : le script doit rester rejouable et
-- compatible PostgreSQL 14 à 17.

BEGIN;

DROP TABLE IF EXISTS public.orders;
DROP TABLE IF EXISTS public.users;

-- Seule table dumpée par le job E2E (type: tables, tables: [public.users]).
CREATE TABLE public.users (
  id         serial PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.users (email, full_name, is_active)
SELECT 'user' || g::text || '@example.test', 'Utilisateur ' || g::text, g % 7 <> 0
FROM generate_series(1, 500) g;

-- Volontairement hors du job : vérifie que le filtrage par table de pg_dump
-- exclut bien le reste du schéma.
CREATE TABLE public.orders (
  id        serial PRIMARY KEY,
  user_id   integer NOT NULL REFERENCES public.users (id),
  amount    numeric(10, 2) NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orders (user_id, amount)
SELECT (g % 500) + 1, (g * 13 % 9999) / 100.0
FROM generate_series(1, 1000) g;

COMMIT;
