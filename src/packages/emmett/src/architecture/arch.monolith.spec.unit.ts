import { emmettArch } from '.';

const guests = emmettArch.component('guests');

const pricing = emmettArch.component('pricing');

const groupReservations = emmettArch.component('group-reservations');

const reservations = emmettArch.component('reservations', {
  components: { groupReservations },
});

const ccc = reservations.components.groupReservations;

const hotelManagement = emmettArch.container('hotel-management', {
  guests,
  reservations,
  pricing,
});
