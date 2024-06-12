import { ValidationError } from '../errors';

export const formatDateToUtcYYYYMMDD = (date: Date) => {
  // Use the 'en-CA' locale which formats as 'yyyy-mm-dd'
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Format the date
  return formatter.format(date);
};

// Function to validate 'yyyy-mm-dd' format
export const isValidYYYYMMDD = (dateString: string) => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(dateString);
};

export const parseDateFromUtcYYYYMMDD = (dateString: string) => {
  const date = new Date(dateString + 'T00:00:00Z');

  if (!isValidYYYYMMDD(dateString)) {
    throw new ValidationError('Invalid date format, must be yyyy-mm-dd');
  }

  if (isNaN(date.getTime())) {
    throw new ValidationError('Invalid date format');
  }

  return date;
};
