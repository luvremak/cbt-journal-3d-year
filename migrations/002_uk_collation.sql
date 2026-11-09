-- spec §4: список клієнтів — за ім'ям українською абеткою, без урахування регістру.
-- ICU-колація рівня 2 (ks-level2): розрізняє літери (Е/Є, И/І/Ї/Й, Г/Ґ), ігнорує регістр.
-- Та сама поведінка в коді: Intl.Collator('uk', { sensitivity: 'accent' }).
CREATE COLLATION IF NOT EXISTS uk_ci (provider = icu, locale = 'uk-u-ks-level2', deterministic = false);
