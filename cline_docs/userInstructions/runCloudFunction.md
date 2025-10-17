# Instructions to Run the Cloud Function

Your `gcloud` authentication tokens have expired. Please follow these steps to re-authenticate and trigger the `scheduledCardSync` function.

1. **Log in to `gcloud`**:
    Run the following command in your terminal. This will open a browser window for you to log in to your Google account and grant the necessary permissions to the gcloud CLI.

    ```bash
    gcloud auth login
    ```

2. **Trigger the Cloud Function**:
    Once you have successfully logged in, run the following command to execute the function:

    ```bash
    gcloud functions call scheduledCardSync --region=us-central1
    ```

This will invoke the function with your new, valid authentication credentials.
