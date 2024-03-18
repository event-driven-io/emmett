Feature: Time-Travel

  Scenario: Travels to the first version of an event stream
    Given an event store with the following events:
      | EventID | EventType          | EventData                                             |
      | 1       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 2       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 3       | DiscountApplied    | { "percent": 10 }                                     |
    When I travel to the **first** version of the event stream
    Then the ShoppingCart should have the following state:
      {
        "totalAmount": 30,
        "productItems": [
          { "productId": "Book-1", "quantity": 10, "price": 3 }
        ],
      }

  Scenario: Travels to the second version of an event stream
    Given an event store with the following events:
      | EventID | EventType          | EventData                                             |
      | 1       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 2       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 3       | DiscountApplied    | { "percent": 10 }                                     |
    When I travel to the **second** version of the event stream
    Then the ShoppingCart should have the following state:
      {
        "totalAmount": 60,
        "productItems": [
          { "productId": "Book-1", "quantity": 10, "price": 3 },
          { "productId": "Book-1", "quantity": 10, "price": 3 },
        ],
      }

  Scenario: Travels to the third version of an event stream
    Given an event store with the following events:
      | EventID | EventType          | EventData                                             |
      | 1       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 2       | ProductItemAdded   | { "productId": "Book-1", "quantity": 10, "price": 3 } |
      | 3       | DiscountApplied    | { "percent": 10 }                                     |
    When I travel to the **third** version of the event stream
    Then the ShoppingCart should have the following state:
      {
        "totalAmount": 54,
        "productItems": [
          { "productId": "Book-1", "quantity": 10, "price": 3 },
          { "productId": "Book-1", "quantity": 10, "price": 3 },
        ],
      }