const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3900;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || '192.168.99.4',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'personal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Middleware
app.use(cors());
app.use(express.json());

// Audit logging middleware
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (data) {
    // Log mutation (POST, PUT, DELETE)
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      pool.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entity_type, entity_id, new_value, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.headers['x-tenant-id'] || null,
          req.headers['x-user-id'] || null,
          req.method,
          req.path.split('/')[1], // entity type from path
          null, // entity_id (can be extracted from params if needed)
          JSON.stringify(req.body),
          req.ip,
        ]
      ).catch(err => console.error('Audit log error:', err));
    }
    res.send = originalSend;
    return res.send(data);
  };
  next();
});

// ============ HEALTH ============
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ ok: true, timestamp: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============ TENANTS ============
app.get('/tenants', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC');
    res.json({ tenants: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tenants', async (req, res) => {
  const { name, domain } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO tenants (name, domain) VALUES ($1, $2) RETURNING *',
      [name, domain]
    );
    res.status(201).json({ tenant: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ EMPLOYEES ============
app.get('/employees', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    res.json({ employees: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/employees/:id', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM employees WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/employees', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { first_name, last_name, email, phone, employment_type, hourly_rate, start_date } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO employees (tenant_id, first_name, last_name, email, phone, employment_type, hourly_rate, start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenantId, first_name, last_name, email, phone, employment_type, hourly_rate, start_date]
    );
    res.status(201).json({ employee: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/employees/:id', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.params;
  const { first_name, last_name, email, phone, employment_type, hourly_rate } = req.body;
  try {
    const result = await pool.query(
      `UPDATE employees SET first_name = $1, last_name = $2, email = $3, phone = $4, employment_type = $5, hourly_rate = $6, updated_at = NOW()
       WHERE id = $7 AND tenant_id = $8 RETURNING *`,
      [first_name, last_name, email, phone, employment_type, hourly_rate, id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ employee: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/employees/:id', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM employees WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ SHIFTS ============
app.get('/shifts', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { week } = req.query;
  try {
    // Parse ISO week (e.g., 2026-W12)
    const [year, w] = week.split('-W');
    const jan4 = new Date(year, 0, 4);
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - jan4.getDay() + (parseInt(w) - 1) * 7);
    
    const result = await pool.query(
      `SELECT * FROM shifts WHERE tenant_id = $1 AND date >= $2 AND date < $2 + INTERVAL '7 days' ORDER BY date, start_time`,
      [tenantId, weekStart.toISOString().split('T')[0]]
    );
    res.json({ shifts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shifts', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { employee_id, date, start_time, end_time, break_minutes } = req.body;
  try {
    const warnings = [];
    
    // Check for rest period (dygnsvila >= 11h between shifts)
    const prevShift = await pool.query(
      `SELECT end_time FROM shifts 
       WHERE tenant_id = $1 AND employee_id = $2 AND date < $3 
       ORDER BY date DESC, start_time DESC LIMIT 1`,
      [tenantId, employee_id, date]
    );
    
    if (prevShift.rows.length > 0) {
      // Calculate hours between end of previous shift and start of this shift
      const prevEndTime = prevShift.rows[0].end_time;
      const prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1); // Assume previous shift is yesterday or earlier
      
      const prevEndDateTime = new Date(`${prevDate.toISOString().split('T')[0]}T${prevEndTime}:00Z`);
      const thisStartDateTime = new Date(`${date}T${start_time}:00Z`);
      const hoursBetween = (thisStartDateTime - prevEndDateTime) / (1000 * 60 * 60);
      
      if (hoursBetween < 11) {
        warnings.push(`Dygnsvila: ${Math.round(hoursBetween * 10) / 10}h (rekommendation: >= 11h)`);
      }
    }
    
    // Check for weekly rest (veckovila >= 36h per week)
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    const weeklyHours = await pool.query(
      `SELECT 
       SUM(EXTRACT(HOUR FROM (end_time - start_time)) - COALESCE(break_minutes, 0) / 60.0) as total_hours
       FROM shifts 
       WHERE tenant_id = $1 AND employee_id = $2 
       AND date >= $3 AND date < $4`,
      [tenantId, employee_id, weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
    );
    
    const currentWeekHours = weeklyHours.rows[0].total_hours || 0;
    const shiftHours = (new Date(`2000-01-01T${end_time}:00`) - new Date(`2000-01-01T${start_time}:00`)) / (1000 * 60 * 60) - (break_minutes || 0) / 60;
    const totalHours = currentWeekHours + shiftHours;
    const weeklyRest = 7 * 24 - totalHours;
    
    if (weeklyRest < 36) {
      warnings.push(`Veckovila: ${Math.round(weeklyRest * 10) / 10}h (rekommendation: >= 36h)`);
    }
    
    // Insert shift
    const result = await pool.query(
      `INSERT INTO shifts (tenant_id, employee_id, date, start_time, end_time, break_minutes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, employee_id, date, start_time, end_time, break_minutes || 0]
    );
    res.status(201).json({ shift: result.rows[0], warnings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/shifts/:id', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.params;
  const { date, start_time, end_time, break_minutes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE shifts SET date = $1, start_time = $2, end_time = $3, break_minutes = $4
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [date, start_time, end_time, break_minutes || 0, id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    res.json({ shift: result.rows[0], warnings: [] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/shifts/:id', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM shifts WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Shift not found' });
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/shifts/open', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  try {
    const result = await pool.query(
      'SELECT * FROM shifts WHERE tenant_id = $1 AND status = $2 ORDER BY date',
      [tenantId, 'open']
    );
    res.json({ openShifts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/shifts/copy-week', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { fromWeek, toWeek } = req.body;
  try {
    // Parse weeks and copy shifts
    const [fromYear, fromW] = fromWeek.split('-W');
    const [toYear, toW] = toWeek.split('-W');
    
    const jan4From = new Date(fromYear, 0, 4);
    const weekStartFrom = new Date(jan4From);
    weekStartFrom.setDate(jan4From.getDate() - jan4From.getDay() + (parseInt(fromW) - 1) * 7);
    
    const jan4To = new Date(toYear, 0, 4);
    const weekStartTo = new Date(jan4To);
    weekStartTo.setDate(jan4To.getDate() - jan4To.getDay() + (parseInt(toW) - 1) * 7);
    
    const daysDiff = Math.round((weekStartTo - weekStartFrom) / (1000 * 60 * 60 * 24));
    
    const result = await pool.query(
      `INSERT INTO shifts (tenant_id, employee_id, date, start_time, end_time, break_minutes, status)
       SELECT tenant_id, employee_id, date + $1 * INTERVAL '1 day', start_time, end_time, break_minutes, status
       FROM shifts WHERE tenant_id = $2 AND date >= $3 AND date < $3 + INTERVAL '7 days'
       RETURNING *`,
      [daysDiff, tenantId, weekStartFrom.toISOString().split('T')[0]]
    );
    res.status(201).json({ copiedShifts: result.rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ TIME ENTRIES ============
app.post('/time/clock-in', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { employee_id, shift_id } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO time_entries (tenant_id, employee_id, clock_in, shift_id)
       VALUES ($1, $2, NOW(), $3) RETURNING *`,
      [tenantId, employee_id, shift_id]
    );
    res.status(201).json({ timeEntry: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/time/clock-out', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  const { id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE time_entries SET clock_out = NOW(), status = 'completed' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Time entry not found' });
    res.json({ timeEntry: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/time/entries', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  try {
    const result = await pool.query(
      'SELECT * FROM time_entries WHERE tenant_id = $1 ORDER BY clock_in DESC',
      [tenantId]
    );
    res.json({ timeEntries: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ AUDIT LOG ============
app.get('/audit-log', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];
  try {
    const result = await pool.query(
      'SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100',
      [tenantId]
    );
    res.json({ auditLog: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Personal API listening on port ${port}`);
});

module.exports = app;
