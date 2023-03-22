export type ConnectionWrapper<T> = {
  db: () => T;
  close: () => Promise<void>;
  assertIsOpen: () => void;
};

export const ConnectionWrapper = <T>(
  connection: T,
  closeConnection: (connection: T) => Promise<void>
): ConnectionWrapper<T> => {
  let isOpen = true;

  const checkIsOpen = () => {
    if (!isOpen)
      throw new Error(
        'Event Store is already closed. You need to create a new one'
      );
  };

  return {
    db: () => {
      checkIsOpen();
      return connection;
    },
    close: async () => {
      if (!isOpen) return;
      isOpen = false;
      await closeConnection(connection);
    },
    assertIsOpen: checkIsOpen,
  };
};
