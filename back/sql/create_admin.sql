-- Create Admin User
INSERT INTO "User" (
    "firstName",
    "lastName",
    "mail",
    "password",
    "role",
    "status",
    "isActif",
    "isLocked",
    "isAccountValidated",
    "isValidated",
    "hasOnboarded",
    "dateLastConnection",
    "createdAt",
    "updatedAt"
) VALUES (
    'Admin',
    'Reloke',
    'support@reloke.com',
    '$2b$10$VchDT7j37Q6WxZhrjDzZl.nFOgFGgg3dlLFGsKvZtZA4pHy.Z1g/q', -- Password is '12-Reloke-@dmin-34'
    'ADMIN',
    'active',
    true,      -- isActif
    false,     -- isLocked
    true,      -- isAccountValidated
    true,      -- isValidated
    true,      -- hasOnboarded
    NOW(),     -- dateLastConnection
    NOW(),     -- createdAt
    NOW()      -- updatedAt
)
ON CONFLICT ("mail") DO NOTHING; -- Avoid duplicate error if re-run
--"$2b$10$0xLbLgMcivp8fbPdtM4Ja.pQ4PfxWUZr7t36Aeex6Z3HeiWBmL.e6"