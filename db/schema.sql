-- 城市智慧停车运营管理平台 表结构（全程 utf8mb4，确保中文正常）
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  role          VARCHAR(16) NOT NULL DEFAULT 'VIEWER',
  status        VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_lots (
  id            INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code          VARCHAR(32) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  district      VARCHAR(64) NOT NULL,
  address       VARCHAR(255) NOT NULL DEFAULT '',
  total_spaces  INT NOT NULL DEFAULT 0,
  status        VARCHAR(16) NOT NULL DEFAULT 'OPEN',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_spaces (
  id                  INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id              INT UNSIGNED NOT NULL,
  code                VARCHAR(32) NOT NULL,
  type                VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
  status              VARCHAR(16) NOT NULL DEFAULT 'FREE',
  zone                VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
  entrance_distance   INT NOT NULL DEFAULT 0,
  is_reserved         TINYINT(1) NOT NULL DEFAULT 0,
  reserved_for        VARCHAR(16) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_lot_space (lot_id, code),
  INDEX idx_lot_status_type (lot_id, status, type),
  INDEX idx_lot_zone (lot_id, zone),
  CONSTRAINT fk_space_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 为已存在的 parking_spaces 补字段（兼容老库）
SET @dbname = DATABASE();
SET @tablename = 'parking_spaces';
SET @col = 'zone';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE parking_spaces ADD COLUMN zone VARCHAR(32) NOT NULL DEFAULT ''DEFAULT'' AFTER status',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = 'entrance_distance';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE parking_spaces ADD COLUMN entrance_distance INT NOT NULL DEFAULT 0 AFTER zone',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = 'is_reserved';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE parking_spaces ADD COLUMN is_reserved TINYINT(1) NOT NULL DEFAULT 0 AFTER entrance_distance',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @col = 'reserved_for';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE parking_spaces ADD COLUMN reserved_for VARCHAR(16) NULL AFTER is_reserved',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 索引补齐
SET @idx = 'idx_lot_status_type';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @idx) = 0,
  'ALTER TABLE parking_spaces ADD INDEX idx_lot_status_type (lot_id, status, type)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx = 'idx_lot_zone';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @idx) = 0,
  'ALTER TABLE parking_spaces ADD INDEX idx_lot_zone (lot_id, zone)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS vehicles (
  id           INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  plate_no     VARCHAR(16) NOT NULL UNIQUE,
  owner_name   VARCHAR(64) NOT NULL DEFAULT '',
  phone        VARCHAR(32) NOT NULL DEFAULT '',
  vehicle_type VARCHAR(16) NOT NULL DEFAULT 'SMALL',
  is_member    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parking_sessions (
  id                  INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lot_id              INT UNSIGNED NOT NULL,
  space_id            INT UNSIGNED NULL,
  plate_no            VARCHAR(16) NOT NULL,
  enter_time          DATETIME(3) NOT NULL,
  exit_time           DATETIME(3) NULL,
  fee_cents           INT NOT NULL DEFAULT 0,
  status              VARCHAR(16) NOT NULL DEFAULT 'PARKED',
  paid                TINYINT(1) NOT NULL DEFAULT 0,
  allocation_strategy VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_session_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE,
  CONSTRAINT fk_session_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE SET NULL,
  INDEX idx_session_status (status),
  INDEX idx_session_plate (plate_no),
  INDEX idx_session_lot_space (lot_id, space_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @tablename = 'parking_sessions';
SET @col = 'allocation_strategy';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE parking_sessions ADD COLUMN allocation_strategy VARCHAR(32) NOT NULL DEFAULT ''MANUAL'' AFTER paid',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx = 'idx_session_lot_space';
SET @stmt = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @idx) = 0,
  'ALTER TABLE parking_sessions ADD INDEX idx_session_lot_space (lot_id, space_id, status)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 车位状态变更审计日志（对账与追溯）
CREATE TABLE IF NOT EXISTS space_status_logs (
  id              INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  space_id        INT UNSIGNED NOT NULL,
  lot_id          INT UNSIGNED NOT NULL,
  old_status      VARCHAR(16) NOT NULL,
  new_status      VARCHAR(16) NOT NULL,
  reason          VARCHAR(64) NOT NULL,
  plate_no        VARCHAR(16) NULL,
  session_id      INT UNSIGNED NULL,
  operator_name   VARCHAR(64) NOT NULL DEFAULT 'SYSTEM',
  note            VARCHAR(255) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_log_space (space_id, created_at),
  INDEX idx_log_lot (lot_id, created_at),
  CONSTRAINT fk_log_space FOREIGN KEY (space_id) REFERENCES parking_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_log_lot FOREIGN KEY (lot_id) REFERENCES parking_lots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
