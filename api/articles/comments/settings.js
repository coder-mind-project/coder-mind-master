/**
 * @function
 * @module CommentSettings
 * @description Provide some middlewares functions.
 * @param {Object} app - A app Object provided by consign.
 * @returns {Object} Containing some middleware functions.
 */
module.exports = app => {
  const { User } = app.config.database.schemas.mongoose
  const { commentError } = app.api.responses

  /**
   * @function
   * @description Verify current user for resource access
   * @private
   * @param {Object} user User object representation
   */
  const verifyUser = async user => {
    const userInDb = await User.findOne({ _id: user._id, deletedAt: null })

    if (!userInDb) {
      throw {
        name: 'id',
        description: 'Usuário não encontrado'
      }
    }

    if (userInDb.id !== user._id) {
      throw {
        name: 'id',
        description: 'Acesso não autorizado'
      }
    }
  }

  /**
   * @function
   * @description Verify all `enum` fields in `comment_settings` table
   * @private
   * @param {Object} settings Comment settings object representation
   */
  const verifyEnumFields = settings => {
    if (
      settings.answersType &&
      settings.answersType !== 'all' &&
      settings.answersType !== 'not-readed' &&
      settings.answersType !== 'only-readed' &&
      settings.answersType !== 'disabled' &&
      settings.answersType !== 'enabled'
    ) {
      throw {
        name: 'answersType',
        description: 'Tipo de respostas inválido'
      }
    }

    if (
      settings.type &&
      settings.type !== 'all' &&
      settings.type !== 'not-readed' &&
      settings.type !== 'only-readed' &&
      settings.type !== 'disabled' &&
      settings.type !== 'enabled'
    ) {
      throw {
        name: 'type',
        description: 'Tipo de comentários inválido'
      }
    }

    if (settings.answersOrder && settings.answersOrder !== 'desc' && settings.answersOrder !== 'asc') {
      throw {
        name: 'answersOrder',
        description: 'Ordem de respostas inválida'
      }
    }

    if (settings.order && settings.order !== 'desc' && settings.order !== 'asc') {
      throw {
        name: 'order',
        description: 'Ordem de comentários inválido'
      }
    }
  }

  /**
   * @function
   * @description Get current comment settings by user Identifier
   *
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {Object} user - The user object representation
   * @middlewareParams {ttl} Date - Time to leave comment, formatted date like `unix timestamp`
   *
   * @returns {Object} The comment settings
   */
  const get = async (req, res) => {
    try {
      const { user } = req.user

      /**
       * @constant {Number} ttl Time to leave
       */
      const ttl = req.headers['cm-ttl-comments']

      if (ttl && ttl >= Date.now()) return res.status(304).send()

      await verifyUser(user)

      const settings = await app.knex
        .select(
          'userId',
          'type',
          'order',
          'limit',
          'notify',
          'answers_type as answersType',
          'answers_order as answersOrder'
        )
        .from('comment_settings')
        .where('userId', user._id)
        .first()

      if (!settings) {
        throw {
          name: 'id',
          description: 'Este usuário não possui configurações de comentário definida'
        }
      }

      settings.notify = Boolean(settings.notify)

      return res.json(settings)
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  /**
   * @function
   * @description Save the comment settings by user Identifier
   *
   * @param {Object} req - Request object provided by Express.js
   * @param {Object} res - Response object provided by Express.js
   *
   * @middlewareParams {Object} user - The user object representation
   *
   * @returns {Object} The comment settings
   */
  const save = async (req, res) => {
    try {
      verifyEnumFields(req.body)

      const { notify, limit, order, type, answersOrder, answersType } = req.body
      const { user } = req.user

      await verifyUser(user)

      const currentSettings = await app.knex.select().from('comment_settings').where('userId', user._id).first()

      if (!currentSettings) {
        await app.knex
          .insert({
            notify,
            limit,
            order,
            type,
            userId: user._id,
            answers_order: answersOrder,
            answers_type: answersType
          })
          .into('comment_settings')
      } else {
        const updatedSettings = {
          limit: limit || currentSettings.limit,
          notify: notify !== undefined && notify !== null ? notify : currentSettings.limit,
          order: order || currentSettings.order,
          type: type || currentSettings.type,
          answers_order: answersOrder || currentSettings.answers_order,
          answers_type: answersType || currentSettings.answers_type,
          updated_at: app.knex.fn.now()
        }

        await app.knex('comment_settings').where('userId', user._id).update(updatedSettings)
      }

      const settings = await app.knex
        .select(
          'userId',
          'type',
          'order',
          'limit',
          'notify',
          'answers_type as answersType',
          'answers_order as answersOrder'
        )
        .from('comment_settings')
        .where('userId', user._id)
        .first()

      settings.notify = Boolean(settings.notify)

      // Define time to leave of new requests
      settings.ttl = Date.now() + 1000 * 60 * 60 * 24 * 30

      return res.json(settings)
    } catch (error) {
      const stack = await commentError(error)
      return res.status(stack.code).send(stack)
    }
  }

  return { get, save }
}
