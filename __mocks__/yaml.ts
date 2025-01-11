const yaml = {
  parse: jest.fn((text: string) => ({
    gpt_model: 'gpt-4o',
    gpt_model_for_image_url: 'gpt-4o',
    strings: {
      reset_message: 'Old messages deleted',
      no_openai_key_error: 'No OpenAI key provided. Please contact the bot owner.',
      trial_ended_error: 'Trial period ended. Please contact the bot owner.',
      trial_not_enabled_error: 'Trial period is not enabled. Please contact the bot owner.',
      no_video_error: 'Bot can not process videos.',
      no_answer_error: 'Bot can not answer to this message.',
      help_string: 'This is a bot that can chat with you.',
      error_string: 'An error occurred. Please try again later.'
    },
    max_trials_tokens: 0,
    prompts: [
      {
        name: 'default',
        text: 'You are a helpful assistant.'
      }
    ]
  }))
};

export default yaml; 