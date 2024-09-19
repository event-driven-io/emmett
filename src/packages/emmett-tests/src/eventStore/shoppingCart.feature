Feature: ShoppingCart
  Scenario: Add a product to the shopping cart
    Given I have a shopping cart
    When I add a product to the shopping cart
    Then the shopping cart should contain 1 product

  Scenario: Add a product to the shopping cart changes the total price
    Given I have an empty shopping cart
    And there is a product item with id "Book-1" and price 3
    When I add a 10 units to the shopping cart
    Then the total price of the shopping cart should be 30

  Scenario: Apply a discount to the shopping cart
    Given there is a product item with id "Book-1" and price 3
    And I have a shopping cart with 10 units of product "Book-1"
    When I apply a 10% discount to the shopping cart
    Then the total price of the shopping cart should be 27