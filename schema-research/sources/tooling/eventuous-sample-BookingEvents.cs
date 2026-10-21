using Eventuous;
using NodaTime;

// ReSharper disable NotAccessedPositionalProperty.Global

namespace Bookings.Domain.Bookings;

public static class BookingEvents {
    public static class V1 {
        [EventType("V1.RoomBooked")]
        public record RoomBooked(
                string         GuestId,
                string         RoomId,
                LocalDate      CheckInDate,
                LocalDate      CheckOutDate,
                float          BookingPrice,
                float          PrepaidAmount,
                float          OutstandingAmount,
                string         Currency,
                DateTimeOffset BookingDate
            );

        [EventType("V1.PaymentRecorded")]
        public record PaymentRecorded(
                float          PaidAmount,
                float          Outstanding,
                string         Currency,
                string         PaymentId,
                string         PaidBy,
                DateTimeOffset PaidAt
            );

        [EventType("V1.FullyPaid")]
        public record BookingFullyPaid(DateTimeOffset FullyPaidAt);

        [EventType("V1.Overpaid")]
        public record BookingOverpaid(DateTimeOffset OverpaidAt);

        [EventType("V1.BookingCancelled")]
        public record BookingCancelled(string CancelledBy, DateTimeOffset CancelledAt);
    }
}
