-- Rodado como o usuario postgres por provisionar.sh (psql -v ON_ERROR_STOP=1 -f).
-- As senhas vem de variaveis de ambiente do processo (\getenv), lidas do SSM:
-- nunca ficam em arquivo nem na linha de comando. Pode rodar de novo.
\set ON_ERROR_STOP on
SET log_statement = 'none';
SET log_min_duration_statement = -1;

\getenv senha_teste SENHA_DONO_TESTE
\getenv senha_producao SENHA_DONO_PRODUCAO

-- Papel de aplicacao, sem login: so recebe privilegios, nunca conecta.
SELECT 'CREATE ROLE saude_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saude_app')
\gexec

-- Donos: LOGIN, nunca superusuario nem CREATEROLE; a senha e reaplicada a cada execucao.
SELECT 'CREATE ROLE saude_dono_teste LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saude_dono_teste')
\gexec
SELECT 'CREATE ROLE saude_dono_producao LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saude_dono_producao')
\gexec
SELECT format('ALTER ROLE saude_dono_teste PASSWORD %L', :'senha_teste') \gexec
SELECT format('ALTER ROLE saude_dono_producao PASSWORD %L', :'senha_producao') \gexec

GRANT saude_app TO saude_dono_teste;
GRANT saude_app TO saude_dono_producao;

SELECT 'CREATE DATABASE saude_teste OWNER saude_dono_teste'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'saude_teste')
\gexec
SELECT 'CREATE DATABASE saude_producao OWNER saude_dono_producao'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'saude_producao')
\gexec

-- Cada dono so conecta no proprio banco.
REVOKE CONNECT ON DATABASE saude_teste FROM PUBLIC;
REVOKE CONNECT ON DATABASE saude_producao FROM PUBLIC;
