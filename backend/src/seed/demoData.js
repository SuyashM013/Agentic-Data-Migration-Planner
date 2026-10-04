// Deterministic demo datasets for reviewers. Same output on every call.

const FIRST = ['Amit', 'Rahul', 'Priya', 'Sneha', 'Vikram', 'Anjali', 'Rohan', 'Kavita', 'Suresh', 'Neha'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Gupta', 'Singh', 'Joshi', 'Mishra', 'Yadav', 'Tiwari', 'Rao'];
const CITIES = ['Bhopal', 'Indore', 'Jabalpur', 'Narsimhapur', 'Gwalior', 'Ujjain', 'Sagar', 'Rewa'];
const pad = (n) => String(n).padStart(2, '0');

const sourceSchema = {
  customer_id: 'number',
  full_name: 'string',
  email: 'string',
  phone: 'string',
  city: 'string',
  signup_date: 'string', // DD/MM/YYYY text -> needs date_format
  loyalty_points: 'string', // text in legacy system -> needs string_to_number (incompatible type vs target)
  internal_notes: 'string', // intentionally has NO target (unmapped source field)
};

const targetSchema = {
  id: 'number',
  name: 'string',
  email: 'string',
  contact_number: 'string',
  location: 'string',
  created_at: 'date',
  loyalty_points: { type: 'number', required: false },
  segment: { type: 'string', required: false }, // intentionally has NO source (unmapped target field)
};

function buildFullRecords() {
  const records = [];
  for (let i = 1; i <= 100; i += 1) {
    const digits = String(9000000000 + i * 1234567);
    const phone = i % 3 === 0 ? `+91 ${digits.slice(0, 5)}-${digits.slice(5)}` : i % 3 === 1 ? `+91 ${digits}` : digits;
    const first = FIRST[i % 10];
    const last = LAST[(i * 3) % 10];
    records.push({
      customer_id: i,
      full_name: `${first} ${last}`,
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      phone,
      city: CITIES[i % CITIES.length],
      signup_date: `${pad((i % 28) + 1)}/${pad((i % 12) + 1)}/${2020 + (i % 5)}`,
      loyalty_points: String(i * 10),
      internal_notes: 'migrated from legacy CRM',
    });
  }
  // Record #1 mirrors the example in the brief.
  Object.assign(records[0], { full_name: 'Amit Sharma', email: 'amit@gmail.com', phone: '+91 9876543210', city: 'Bhopal' });

  // Exactly 8 invalid records (record numbers are 1-based positions).
  records[6].full_name = 'Rahul Verma';
  records[6].email = 'invalid-email'; // #7  EMAIL_FORMAT
  records[16].email = 'priya@@example'; // #17 EMAIL_FORMAT + missing phone (two errors on one record)
  records[16].phone = '';
  records[32].email = 'sneha.gmail.com'; // #33 EMAIL_FORMAT
  records[40].signup_date = '31/02/2024'; // #41 TRANSFORM_DATE_FORMAT (not a real date)
  delete records[57].full_name; // #58 MISSING_REQUIRED (name)
  records[63].loyalty_points = 'N/A'; // #64 TRANSFORM_STRING_TO_NUMBER (incompatible value)
  records[76].customer_id = 12; // #77 DUPLICATE_SOURCE_ID (id already used by record #12)
  records[89].phone = '12-34'; // #90 TRANSFORM_NORMALIZE_PHONE (too short)
  return records;
}

function buildMiniRecords() {
  return [
    { customer_id: 1, full_name: 'Amit Sharma', email: 'amit@gmail.com', phone: '+91 9876543210', city: 'Bhopal' },
    { customer_id: 2, full_name: 'Rahul Verma', email: 'invalid-email', phone: '8888888888', city: 'Indore' },
  ];
}

function buildDemoDatasets() {
  return {
    full: {
      name: 'Customer Migration (100 records)',
      description: '100 records: 92 valid, 8 invalid (bad email x3, missing phone, bad date, missing name, non-numeric points, duplicate id, short phone). Also has an unmapped source field and an unmapped target field.',
      sourceSchema,
      targetSchema,
      sampleRecords: buildFullRecords(),
    },
    mini: {
      name: 'Customer Migration (brief example)',
      description: 'The two-record example from the assignment brief.',
      sourceSchema: { customer_id: 'number', full_name: 'string', email: 'string', phone: 'string', city: 'string' },
      targetSchema: { id: 'number', name: 'string', email: 'string', contact_number: 'string', location: 'string' },
      sampleRecords: buildMiniRecords(),
    },
  };
}

module.exports = { buildDemoDatasets };
